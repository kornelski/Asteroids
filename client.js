"use strict";

// Class that renders view of the game
// data source will provide locations of objects to render
function AsteroidDisplay(game_client, canvas)
{
    // this is where data is going to be read from
    this.game_client = game_client;

    // I'm not waiting for onload, because drawing of unloaded image simply does nothing
    // and the screen is redrawn all the time
    this.background_image = new Image();
    this.background_image.src = 'sky.png'

    this.ctx = canvas.getContext('2d');

    // to avoid rebinding on every frame
    this.drawFrame = this.drawFrame.bind(this)

    this.drawFrame();
}

AsteroidDisplay.prototype = {

    // redraws the canvas
    drawFrame: function() {

        // this.ctx.canvas.width = this.ctx.canvas.width can also be used to clear and reset context
        this.ctx.clearRect(0,0, this.ctx.canvas.width, this.ctx.canvas.height);
        this.ctx.save();

        try {
            // eveything is in massive try/finally, because I want context to be restored
            // and next frame scheduled even if drawing throws an error

            this.ctx.strokeStyle = 'white'

            // make sure game data is up to date
            this.game_client.updatePositions();

            // if, because there may be nothing to draw before server sends first update
            if (this.setUpViewport()) {
                this.drawBackground();
                this.drawObjects();
                this.drawParticles();
            }

        } finally {
            this.ctx.restore();
            requestAnimationFrame(this.drawFrame);
        }
    },

    // viewport is area where player is looking at. Here defined by center x,y and size.
    setUpViewport: function() {

        // game server defines what is seen on the screen
        var viewport = this.game_client.getViewport();
        if (!viewport) return false;

        // instead of converting each object's world position and size to screen coordinates
        // every time, just change canvas' coordinates to match game world

        // this will make point 0,0 in center of the canvas
        this.ctx.translate(this.ctx.canvas.width/2, this.ctx.canvas.height/2);

        // zoom to fit viewport size in canvas
        var view_size = Math.max(this.ctx.canvas.width, this.ctx.canvas.height);
        this.ctx.scale(view_size/viewport.view_size, view_size/viewport.view_size);

        // -center will make object at viewport center drawn at 0,0 = scrolling of viewport
        this.ctx.translate(-viewport.x, -viewport.y);

        // because the world wraps, one thing can be seen in multiple places
        // and the background has to be tiled
        // this choses which neighbouring 4 "tiles" are drawn based on where the center of the view is

        this.tile_x = viewport.x > viewport.world_size/2 ? viewport.world_size : -viewport.world_size;
        this.tile_y = viewport.y > viewport.world_size/2 ? viewport.world_size : -viewport.world_size;
        this.world_size = viewport.world_size

        return true;
    },

    drawBackground: function(tile_x, tile_y) {
        // width will be non-0 when it's loaded
        if (this.background_image.width) {
            this.ctx.drawImage(this.background_image,
                    0,0,this.background_image.width, this.background_image.height,
                    0,0,this.world_size, this.world_size);

            this.ctx.drawImage(this.background_image,
                    0,0,this.background_image.width, this.background_image.height,
                    this.tile_x,0,this.world_size, this.world_size);

            this.ctx.drawImage(this.background_image,
                    0,0,this.background_image.width, this.background_image.height,
                    0,this.tile_y,this.world_size, this.world_size);

            this.ctx.drawImage(this.background_image,
                    0,0,this.background_image.width, this.background_image.height,
                    this.tile_x,this.tile_y,this.world_size, this.world_size);
        }

        // uncomment to see how world is tiled
        // this.ctx.strokeRect(0,0, this.world_size, this.world_size);
    },

    drawObjects: function() {

        var objects = this.game_client.objects;
        for(var i=0; i < objects.length; i++) {
            var obj = objects[i];
            // it's a sparse array
            if (!obj) continue;

            switch(obj.type) {
                case 'asteroid':
                    // if whole world is visible and object is in the corner of the screen
                    // then it'd be visible in all 4 places
                    this.drawAsteroid(obj, obj.x, obj.y);
                    this.drawAsteroid(obj, obj.x + this.tile_x, obj.y);
                    this.drawAsteroid(obj, obj.x, obj.y + this.tile_y);
                    this.drawAsteroid(obj, obj.x + this.tile_x, obj.y + this.tile_y);
                    break;

                // I cheat and reuse ship for missile
                case 'missile':
                case 'ship':
                    this.drawShip(obj, obj.x, obj.y);
                    this.drawShip(obj, obj.x + this.tile_x, obj.y);
                    this.drawShip(obj, obj.x, obj.y + this.tile_y);
                    this.drawShip(obj, obj.x + this.tile_x, obj.y + this.tile_y);
                    break;
                default:
                    console.error("Don't know how to draw", obj);
            }
        }
    },

    drawParticles: function() {
        // this makes things shiny
        this.ctx.globalCompositeOperation = 'lighter';
        this.ctx.strokeStyle = '#654';

        var all_particles = this.game_client.getAllParticles();
        for(var j=0; j < all_particles.length; j++) {
            var p = all_particles[j];

            // random size makes it sparkly
            var radius = p.type != 'rock' ? (0.3+Math.random()) : 1.2;
            var diameter = radius*2;

            this.ctx.strokeRect(p.x-radius, p.y-radius, diameter, diameter);
            this.ctx.strokeRect(p.x-radius + this.tile_x, p.y-radius, diameter, diameter);
            this.ctx.strokeRect(p.x-radius, p.y + this.tile_y-radius, diameter, diameter);
            this.ctx.strokeRect(p.x-radius + this.tile_x, p.y + this.tile_y-radius, diameter, diameter);
        }
    },

    drawAsteroid: function(obj, x, y) {
        this.ctx.beginPath();
        // obj.r is radius, shortened to save bandwidth :)
        this.ctx.arc(x, y, obj.r, 0, Math.PI*2, true);
        this.ctx.stroke();
    },

    drawShip: function(obj, x, y) {
        this.ctx.beginPath();
        // obj.a is angle (in radians)
        this.ctx.arc(x, y, obj.r, obj.a-Math.PI/3, obj.a + Math.PI/3, true);
        this.ctx.stroke();
    },
}

function AsteroidControl(game_client, element, keys)
{
    // make the element (canvas) focusable and focus it, so it gets keyboard
    element.tabIndex=0;
    element.focus();

    // returns handler function for either on or off state
    function createHandler(is_on){
        return function(e) {
            switch(e.keyCode) {
                case keys.up:
                    game_client.command("accelerate", is_on);
                    break;
                case keys.left:
                    game_client.command("rotate_left", is_on);
                    break;

                case keys.right:
                    game_client.command("rotate_right", is_on);
                    break;

                case keys.down:
                    game_client.command("shoot", is_on);
                    break;

                default:
                    return true;
            }
            return false;
        }
    }

    element.addEventListener('keydown', createHandler(true), false);
    element.addEventListener('keyup', createHandler(false), false);
}


// "class constant" defines keyCodes for WASD and cursor key controls
AsteroidControl.KEYS = {
    WASD: {up:87, left:65, right:68, down:83},
    Arrows: {up:38, left:37, right:39, down:40},
};

// this class replicates server's game state on client-side
// it abstracts away communication/network protocol
// here I cheat by passing game object rather than websocket
function AsteroidGameClient(game)
{
    this.game = game;
    this.objects = [];
    this.particles = [];
    this.viewport = undefined
    this.last_particle_update = Date.now()

    // tell the game there's new player
    game.connect(this);

    // this is just for information, shows how much data has been received in last second
    setInterval(function(){
        console.log(this.transferred/1000,"KB/s");
        this.transferred=0;
    }.bind(this), 1000);
}

AsteroidGameClient.prototype = {

    getViewport: function() {
        return this.viewport;
    },

    getAllObjects: function() {
        return this.objects;
    },

    getAllParticles: function(){
        return this.particles;
    },

    updatePositions: function() {

        if (!this.viewport) return; // no information from server yet

        // time cached for performance and to avoid skew when update takes noticeable time
        var now = Date.now();

        // Extrapolation. For every x,y position I also get velocity and timestamp when move started
        // so I add velocity multiplied by time elapsed to get current position
        // This applies to move of viewport as well.
        var viewport_duration_s = (now - this.viewport.timestamp)/1000;
        this.viewport.x += this.viewport.vx * viewport_duration_s;
        this.viewport.y += this.viewport.vy * viewport_duration_s;
        this.viewport.timestamp = now;

        var world_size = this.viewport.world_size;
        var obj_duration_s = (now - this.objects_timestmap)/1000;
        this.objects_timestmap = now;
        for(var i=0; i < this.objects.length; i++) {
            var obj = this.objects[i];

            // it's a sparse array - there are "gaps" from deleted objects
            if (!obj) continue;

            obj.x += obj.vx * obj_duration_s;
            obj.y += obj.vy * obj_duration_s;

            // wrap around the map
            if (obj.y > world_size) {
                obj.y %= world_size;
            }
            else if (obj.y < 0) {
                obj.y += world_size;
            }

            if (obj.x > world_size) {
                obj.x %= world_size;
            }
            else if (obj.x < 0) {
                obj.x += world_size;
            }
        }

        this.updateParticlePositions(this.particles, this.last_particle_update, now);
        this.last_particle_update = now;
    },

    updateParticlePositions: function(particles, from_time, to_time) {

        var duration_s = (to_time - from_time)/1000;
        for(var j=0; j < particles.length; j++) {
            var p = particles[j];

            // ttl = time to live, in seconds
            p.ttl -= duration_s;
            if (p.ttl < 0) {
                particles.splice(j,1);
                j--;
            }

            // moves the particle. Hint: it'd be nice to add friction.
            p.x += p.vx * duration_s;
            p.y += p.vy * duration_s;
        }
    },

    // Sends given command to the server
    command: function(command, arg) {
        this.game.command(command, arg, this.player_id);
    },

    // Interprets server's command
    onmessage: function(event) {
        this.transferred += event.data.length; // tracking bandwidth

        var data = JSON.parse(event.data);
        switch(data.cmd) {
            // Server needs to identify player somehow (when player sends move/shoot commands, etc.),
            // so server sends player's ID to the client first
            case 'id':
                this.player_id = data.id;
                break;

            // That's the important whole-world update
            case 'world':

                this.objects = data.objects;
                this.objects_timestmap = data.timestamp;

                if (data.viewport) {
                    this.viewport = data.viewport;
                    this.viewport.timestamp = data.timestamp;
                }

                // new particles have to be appended to old particles array
                if (data.new_particles && data.new_particles.length) {
                    // since new particles have been created at different time than local ones
                    // the time and position has to be normalized to local time
                    this.updateParticlePositions(data.new_particles, data.timestamp, this.last_particle_update);

                    this.particles = this.particles.concat(data.new_particles);
                }
                break;
            default:
                console.error("Odd data", data);
        }
    }
}
