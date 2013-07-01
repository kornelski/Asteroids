"use strict";

// random value spanning the range, but from -range/2 to range/2
// used for x,y random velocities, although random angle and distance would be nicer
function rand(range)
{
    return (Math.random()-0.5)*range;
}


// constructor for basic actor (I don't bother with full inheritance here)
// type_name is mostly for describing how it looks, rather than what it is
function Actor(game, type_name, x, y, radius)
{
    this.type = type_name;
    this.game = game;
    this.origin = {x:+x||0, y:+y||0};
    this.velocity = {x:rand(10), y:rand(10)};
    this.radius = radius;
    this.send = true; // make sure initial state is sent to the client
}

// owner is the Player object
function Ship(game, owner, x, y)
{
    Actor.call(this, game, 'ship', x, y, 5);
    this.owner = owner;
    this.health = 100;
    this.angle = Math.random()*Math.PI*2;
    this.rotation_power = 5;
    this.engine_power = 70;

    // counters for delays
    this.reloading = 0;
    this.engine_sparks = 0;
}

Ship.prototype = {

    frame: function(duration_s) {
        // on each frame it reloads missiles (a bit)
        if (this.reloading > 0) {
            this.reloading -= duration_s;
        }
    },

    // called when takes damage (at touch point)
    hit: function(points, touchpoint) {
        this.health -= points;
        // FIXME: should explode when health < 0

        for(var i=0; i < points/2+2; i++) {
            this.game.addParticle('spark',
                {x:touchpoint.x+rand(this.radius/2),y:touchpoint.y+rand(this.radius/2)},
                {x:this.velocity.x/4+rand(points),y:this.velocity.y/4+rand(points)}, 1.5+Math.random());
        }
    },

    // callback from physics
    collide: function(other, touchpoint) {
        if (other instanceof Ship) {
            this.hit(10, touchpoint);
            other.hit(10, touchpoint);
            return true;
        } else {
            // ship doesn't know how to collide with Asteroid or Missile,
            // that logic arbitrarily is in the other class
            return other.collide(this, touchpoint);
        }
    },

    rotate: function(direction) {
        this.send = true; // make sure client sees the rotation
        this.angle += direction * this.rotation_power;
    },

    shoot: function() {
        if (this.reloading <= 0) {
            this.reloading += 0.3; // 0.3s to fire next one

            var missile = new Missile(this.game, this.owner, this.origin, this.velocity, this.angle)
            this.game.addObject(missile)
        }
    },

    accelerate: function(duration_s) {
        this.send = true;

        // acceleration direction and magnitude
        var ax = Math.cos(this.angle + Math.PI) * this.engine_power;
        var ay = Math.sin(this.angle + Math.PI) * this.engine_power;

        this.velocity.x += ax * duration_s;
        this.velocity.y += ay * duration_s;

        // emit 45 sparks per second
        this.engine_sparks += duration_s;
        while(this.engine_sparks > 0) {
            this.game.addParticle('engine', this.origin,
                {x:this.velocity.x/2-ax/3+rand(10),y:this.velocity.y/2-ay/3+rand(10)},
                0.5+Math.random()*3);
            this.engine_sparks -= 1/45;
        }
    }
};

function Asteroid(game, x, y, velocity, size)
{
    Actor.call(this, game, 'asteroid', x, y, size);
    this.health = size;
    this.velocity.x = velocity.x + rand(100/size);
    this.velocity.y = velocity.y + rand(100/size);
}

Asteroid.prototype = {
    frame: function() {},

    hit: function(points, touchpoint) {
        this.health -= points;

        // emit bits of rock that were shot away
        for(var i=0; i < points; i++) {
            this.game.addParticle('rock',
                {x:touchpoint.x+rand(this.radius/2),y:touchpoint.y+rand(this.radius/2)},
                {x:this.velocity.x/4+rand(10),y:this.velocity.y/4+rand(10)}, 0.5+Math.random()*5);
        }

        this.radius -= points/10;
        if (this.health <= 0) {
            this.game.removeObject(this); // destroyed!

            var r2 = this.radius*0.6; // new, smaller ones
            if (r2 < 2) return;

            // they're randomly positioned, but it could be fun to base that on touch point (fly awya from the missile)
            this.game.addObject(new Asteroid(this.game, this.origin.x + rand(r2), this.origin.y + rand(r2),
                {x:this.velocity.x + rand(20+250/r2), y:this.velocity.y+rand(20+250/r2)}, r2))
            this.game.addObject(new Asteroid(this.game, this.origin.x + rand(r2), this.origin.y + rand(r2),
                {x:this.velocity.x + rand(20+250/r2), y:this.velocity.y+rand(20+250/r2)}, r2))

            for(var j=0; j < (3+r2); j++) {
                this.game.addParticle('rock',
                    {x:this.origin.x+rand(this.radius),y:this.origin.y+rand(this.radius)},
                    {x:this.velocity.x/4+rand(10),y:this.velocity.y/4+rand(10)}, 0.5+Math.random()*5);
            }
        }
    },

    collide: function(other, touchpoint) {
        if (other instanceof Asteroid) {
            return true; // bounce
        }
        else if (other instanceof Ship) {
            // FIXME: use velocity and mass?
            other.hit(Math.max(5,this.health), touchpoint);
            this.hit(0.5, touchpoint);
            return true;
        }
        return other.collide(this, touchpoint);
    },
};

function Missile(game, owner, origin, velocity, angle)
{
    Actor.call(this, game, 'ship', origin.x, origin.y, 2)
    this.angle = angle;
    this.owner = owner;

    var initial_speed = 45;
    this.velocity.x = velocity.x - Math.cos(angle) * initial_speed;
    this.velocity.y = velocity.y - Math.sin(angle) * initial_speed;
    this.acceleration = 360;

    this.power = 10; // hit points
    this.fuel = 1 + Math.random()/10;

    this.engine_sparks = 0;
}

Missile.prototype = {
    frame: function(duration_s) {
        // acceleration in that direction
        var ax = Math.cos(this.angle) * this.acceleration;
        var ay = Math.sin(this.angle) * this.acceleration;

        this.fuel -= duration_s; // use fuel
        if (this.fuel > 0) { // and accelerate only if there's fuel left
            this.send = true;

            if (this.fuel < 0.7) {
            this.velocity.x -= ax * duration_s;
            this.velocity.y -= ay * duration_s;
                this.engine_sparks += duration_s;
            }
        }

        while(this.engine_sparks > 0) {
            this.game.addParticle('engine',
                {x:this.origin.x+rand(2),y:this.origin.y+rand(2)},
                {x:this.velocity.x/2+ax+rand(30),y:this.velocity.y/2+ay+rand(30)},
                0.3+Math.random()*0.5);
            this.engine_sparks -= 1/75;
        }

        // fuel abused as timer -- end of life for the missile
        if (this.fuel < -0.5) {
           this.game.addParticle('spark', this.origin,
                {x:this.velocity.x*0.8+rand(50), y:this.velocity.y*0.8+rand(50)}, Math.random()/2)
           this.game.addParticle('spark', this.origin,
                {x:this.velocity.x*0.6+rand(30), y:this.velocity.y*0.6+rand(30)}, Math.random()/2)
           this.game.removeObject(this);
        }
    },

    collide: function(other, touchpoint) {
        // don't explode when hitting owner of the missile or his missile
        // since the missile starts inside the ship

        if (other instanceof Missile) {
            if (this.owner !== other.owner) {
                // both explode
                this.game.removeObject(this);
                this.game.removeObject(other);
            }
        } else if (!(other instanceof Ship) || other.owner !== this.owner) {
            // hit other player's ship or something else
            other.hit(this.power, touchpoint);
            this.game.removeObject(this);
            // FIXME: add explosions
        }
        return false;
    }
};
