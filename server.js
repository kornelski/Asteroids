"use strict";

// rounds number to 2 decimal places (floats in JSON may be quite long otherwise)
function round(num)
{
    return (num*100|0)/100;
}

// Simple class representing player that has connected to the game
function Player(client, id)
{
    this.id = id;
    this.ship = null;
    this.client = client;

    // state of keys pressed
    this.rotate_left = false
    this.rotate_right = false
    this.accelerate = false
    this.shoot = false
}

Player.prototype = {
    // called every frame
    frame: function(duration_s) {

        if (this.rotate_left) {
            // I allow framerate variability, so magnitude of action is multiplied by time
            // this could be even more precise (but complicated) if duration_s was calculated from client's time
            this.ship.rotate(-1 * duration_s);
        }
        if (this.rotate_right) {
            this.ship.rotate(1 * duration_s);
        }
        if (this.accelerate) {
            this.ship.accelerate(duration_s);
        }
        if (this.shoot) {
            this.ship.shoot();
        }
    }
}

// Main server class
function AsteroidGameServer()
{
    // to use it from timer without rebinding all over again
    this.gameFrame = this.gameFrame.bind(this)

    // each object will get unique ID
    this.uid = 0;

    // Although server sends only changed objects, some are periodically "refreshed"
    // to keep everything in sync (otherwise different math precision makes their position drift)
    this.refresh_object_last_index=0;

    this.objects = [];
    // objects are not removed immediately, as this would complicate collisions and efficient client updates
    this.objects_to_remove = [];
    this.new_particles = [];

    this.players = [];

    this.setUpWorld();

    // initialize timer for first game frame
    this.last_frame_time = Date.now();
    this.gameFrame()
}

AsteroidGameServer.prototype = {

    setUpWorld: function() {
        this.world_size = 500

        this.addObject(new Asteroid(this, rand(this.world_size), rand(this.world_size), {x:0,y:0}, 30));
        this.addObject(new Asteroid(this, rand(this.world_size), rand(this.world_size), {x:0,y:0}, 25));
        this.addObject(new Asteroid(this, rand(this.world_size), rand(this.world_size), {x:0,y:0}, 20));
        this.addObject(new Asteroid(this, rand(this.world_size), rand(this.world_size), {x:0,y:0}, 10));

        // no players yet, they'll "connect" later
    },

    gameFrame: function(){
        // duration in ms is for timer, but rest of the game works in units per second (they're nicer!)
        var duration_ms = Date.now() - this.last_frame_time;
        var duration_s = duration_ms/1000;

        // although game is supposed to be running at fixed frame rate
        // I still track frame duration and include it in calculations
        // just for demostration (it could be omitted in truly fixed-framerate game)
        this.performActions(duration_s);
        this.moveObjects(duration_s);
        this.checkCollisions();
        this.broadcastObjects();
        this.removeObjects();

        setTimeout(this.gameFrame, 1000/30 - duration_ms);
        this.last_frame_time = Date.now();
    },

    performActions: function(duration_s) {

        // each player and each object in the game gets time to think
        for(var i=0; i < this.players.length; i++) {
            this.players[i].frame(duration_s);
        }

        var objects = this.objects;
        for(var j=0; j < objects.length; j++) {
            objects[j].frame(duration_s);
        }
    },

    // basic movement
    moveObjects: function(duration_s) {
        var objects = this.objects;

        for(var i=0; i < objects.length; i++) {
            var o = objects[i]

            // velocity * duration_s is a poor integration method
            // and it's not robust for very variable frame rates
            o.origin.x += o.velocity.x * duration_s;
            o.origin.y += o.velocity.y * duration_s;

            // wrap around if object has moved outside "edge" of the world
            if (o.origin.y > this.world_size) {
                o.origin.y -= this.world_size;
            }
            else if (o.origin.y < 0) {
                o.origin.y += this.world_size;
            }

            if (o.origin.x > this.world_size) {
                o.origin.x -= this.world_size;
            }
            else if (o.origin.x < 0) {
                o.origin.x += this.world_size;
            }
        }
    },

    checkCollisions: function() {
        var objects = this.objects;
        var half_world = this.world_size/2;

        // during collisions new objects can be added, which increases size of objects array
        // but those objects must be ignored (otherwise exploding missile destroys new asteroid before it appears)
        var end = objects.length;

        for(var i=0; i < end; i++) {
            var o1 = objects[i]
            for(var j=i+1; j < end; j++) {
                var o2 = objects[j];

                // world wraps around, so something at right edge must collide with something at left edge
                // so when objects are very far (presumably near edges),
                // pretend they're moved the center so collision works normally
                var delta_x = o1.origin.x - o2.origin.x;
                if (delta_x > half_world) {
                    delta_x = -this.world_size+delta_x;
                }
                else if (delta_x < -half_world) {
                    delta_x = delta_x+this.world_size;
                }

                var delta_y = o1.origin.y - o2.origin.y;
                if (delta_y > half_world) {
                    delta_y = -this.world_size+delta_y;
                }
                else if (delta_y < -half_world) {
                    delta_y = delta_y+this.world_size;
                }

                // sphere collision by checking whether
                // sum of radiuses is smaller than distance between centers
                var dist = delta_x*delta_x + delta_y*delta_y;
                var radii = o1.radius + o2.radius;

                if (dist > radii*radii) continue;

                // mark objects as "interesting" to send (since they're likely to change velocity)
                o1.send=o2.send=true;

                // They touched at point which is weighed average of their positions and radiuses.
                // I can't use o2.origin, because delta may have been wrapped around
                // so I compute o2 from o1-delta, so they're both in the same "tile" of the world
                var touchpoint = {
                    x: (o1.origin.x*o2.radius + (o1.origin.x-delta_x)*o1.radius) / radii,
                    y: (o1.origin.y*o2.radius + (o1.origin.y-delta_y)*o1.radius) / radii,
                }

                // notify objects that they've collided
                // of collide returns true, it means they really did collide and should bounce
                if (o1.collide(o2, touchpoint)) {

                    // stupid bounce. Needs more trigonometry.
                    // also assumes that mass=radius, which is wrong
                    if (Math.abs(delta_x) > Math.abs(delta_y)) {
                        var v1 = o1.velocity.x*0.7
                        var v2 = o2.velocity.x*0.7
                        o1.velocity.x = (v1*(o1.radius-o2.radius) + 2*o2.radius*v2)/(radii)
                        o2.velocity.x = (v2*(o2.radius-o1.radius) + 2*o1.radius*v1)/(radii)
                    } else {
                        var v1 = o1.velocity.y*0.7
                        var v2 = o2.velocity.y*0.7
                        o1.velocity.y = (v1*(o1.radius-o2.radius) + 2*o2.radius*v2)/(radii)
                        o2.velocity.y = (v2*(o2.radius-o1.radius) + 2*o1.radius*v1)/(radii)
                    }

                    // Objects may be overlapping and stuck, so stop them from touching
                    // by moving away from touch point by their respective radius

                    // dist wasn't squared earlier for performance.
                    dist = Math.sqrt(dist)
                    var normal = { // direction vector
                        x: delta_x/dist,
                        y: delta_y/dist,
                    }

                    o1.origin.x = touchpoint.x + normal.x * o1.radius
                    o1.origin.y = touchpoint.y + normal.y * o1.radius
                    o2.origin.x = touchpoint.x - normal.x * o2.radius
                    o2.origin.y = touchpoint.y - normal.y * o2.radius
                }
            }
        }
    },

    // tell everyone that something has changed
    broadcastObjects: function() {

        // not an array, since only changed objects are sent
        var objects = {};

        // and since only changes are sent, I can send them whenever
        // so I can also limit number of them sent per frame to keep game mostly smooth
        var max_objects_per_frame = 10;

        // I'll send update for one extra object per frame in case
        // client's extrapolated position drifted away from server's
        // and that also helps newly connected clients to learn about all objects
        this.objects[this.refresh_object_last_index++ % this.objects.length].send=true;

        // if player's ship changed position, then viewport that tracks it should too
        for(var k=0; k < this.players.length; k++) {
            this.players[k].send_viewport = this.players[k].ship.send;
        }

        // collect objects to send
        for(var i=0; i < this.objects.length; i++) {
            var o = this.objects[i];

            if (!o.send) continue;
            if (max_objects_per_frame-- <= 0) break;
            o.send=false;

            // I only send simplified copy of the object to client
            objects[o.id] = {
                x: round(o.origin.x),
                y: round(o.origin.y),
                vx: o.velocity.x|0, // rounds to integer. It's velocity per second, so fractional precision is unnecessary
                vy: o.velocity.y|0,
                type: o.type,
                a: round(o.angle),
                r: round(o.radius),
            }
        }

        // that's the "packet" sent to the client
        var data = {
            cmd:'world',
            timestamp: Date.now(),
            objects:objects,
        };

        if (this.new_particles.length) {
            data.new_particles = this.new_particles;
        }

        if (this.objects_to_remove.length) {
            data.remove = []
            for(var l=0; l < this.objects_to_remove.length; l++) {
                data.remove.push(this.objects_to_remove[l].id)
            }
        }

        for(var j=0; j < this.players.length; j++) {
            var player = this.players[j];

            // player's viewport tracks the ship
            data.viewport = player.send_viewport ? {
                x: round(player.ship.origin.x),
                y: round(player.ship.origin.y),
                vx: player.ship.velocity.x|0,
                vy: player.ship.velocity.y|0,
                world_size: this.world_size,
                view_size: this.world_size*0.6,
            } : undefined;

            // fake websocket :)
            player.client.onmessage({data:JSON.stringify(data)});
        }
    },

    // ttl is time to live, in seconds
    addParticle: function(type, origin, velocity, ttl) {
        this.new_particles.push({
            type:type,
            x:origin.x|0, y:origin.y|0,
            vx:velocity.x|0, vy:velocity.y|0,
            ttl: round(ttl),
        });
    },

    // place new object on the map
    addObject: function(obj) {
        obj.id = ++this.uid; // they need unique ID to be matched on client side
        this.objects.push(obj);
    },

    removeObject: function(obj) {
        obj.send = false; // its ID will be in removed objects list, no need to send details
        this.objects_to_remove.push(obj);
    },

    removeObjects: function() {
        // objects are removed for real only after information about removal has been sent to clients
        // and all physics and game logic has finished full frame

        var toremove = this.objects_to_remove;
        this.objects_to_remove = [];

        for(var i=0; i < toremove.length; i++) {
            this.objects.splice(this.objects.indexOf(toremove[i]),1);
        }

        // particles are kept for one frame only. It's up to the client to animate them.
        if (this.new_particles.length) this.new_particles = [];
    },

    // when new client connects create ship for it
    connect: function(client) {
        var player = new Player(client, this.players.length);
        this.players.push(player);

        var ship = new Ship(this, player, (Math.random()-0.5)*this.world_size, (Math.random()-0.5)*this.world_size);
        player.ship = ship;
        this.addObject(ship);

        client.onmessage({data:JSON.stringify({cmd:"id", id:player.id})});
    },

    // very terse way of saying that command "rotate_left" sets player.rotate_left = arg, etc.
    command: function(command, arg, player_id) {
        this.players[player_id][command] = arg;
    },
}
