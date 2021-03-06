/** Copyright Stewart Allen <sa@grid.space> -- All Rights Reserved */

"use strict";

// this code runs in kiri's main loop
if (!self.kiri) self.kiri = {};

let loc = self.location,
    host = loc.hostname,
    port = loc.port,
    proto = loc.protocol,
    time = function() { return new Date().getTime() },
    KIRI = self.kiri,
    BASE = self.base,
    seqid = 1,
    running = {},
    slicing = {},
    worker = null;

/**
 * @param {Function} fn name of function in KIRI.worker
 * @param {Object} data to send to server
 * @param {Function} onreply function to call on reply messages
 * @param {Object[]} zerocopy array of objects to pass using zerocopy
 */
function send(fn, data, onreply, zerocopy) {
    let seq = seqid++;

    running[seq] = { fn:onreply };
    // console.log('send', data);

    try {
        worker.postMessage({
            seq: seq,
            task: fn,
            time: time(),
            data: data
        }, zerocopy);
    } catch (error) {
        console.trace('work send error', {data, error});
    }
}

// code is running in the browser / client context
KIRI.client =
KIRI.work = {
    send: send,

    newWorker: function() {
        if (self.createWorker) {
            return self.createWorker();
        } else {
            return new Worker(`/code/worker.js?${self.kiri.version}`);
        }
    },

    isSlicing : function() {
        let current = 0;
        for (let key in slicing) {
            current++;
        }
        return current > 0;
    },

    restart : function() {
        if (worker) {
            worker.terminate();
        }

        for (let key in slicing) {
            slicing[key]({error: "cancelled slicing"});
        }

        slicing = {};
        running = {};
        worker = KIRI.work.newWorker();

        worker.onmessage = function(e) {
            let now = time(),
                reply = e.data,
                record = running[reply.seq],
                onreply = record.fn;

            // console.log('recv', reply.data)
            if (reply.done) {
                delete running[reply.seq];
            }

            // calculate and replace recv time
            reply.time_recv = now - reply.time_recv;

            onreply(reply.data, reply);
        };
    },

    decimate : function(vertices, options, callback) {
        let alert = KIRI.api.show.alert('processing model', 1000);
        vertices = vertices.buffer.slice(0);
        send("decimate", {vertices, options}, function(output) {
            KIRI.api.hide.alert(alert);
            callback(output);
        });
    },

    config : function(obj) {
        send("config", obj, function(reply) {
            // console.log({config:reply});
        });
    },

    clear : function(widget) {
        send("clear", widget ? {id:widget.id} : {}, function(reply) {
            // console.log({clear:reply});
        });
    },

    snap : function(data) {
        send("snap", data, function(reply) {
            // console.log({snap:reply})
        });
    },

    slice : function(settings, widget, callback) {
        let rotation = (Math.PI/180) * (settings.process.sliceRotation || 0);
        let centerz;
        let movez;
        if (rotation) {
            let bbox1 = widget.getBoundingBox(true);
            widget._rotate(0,rotation,0,true);
            widget.center();
            let bbox2 = widget.getBoundingBox(true);
            centerz = (bbox2.max.z - bbox2.min.z)/2;
            movez = centerz - (bbox1.max.z - bbox1.min.z)/2;
        }
        let vertices = widget.getGeoVertices().buffer.slice(0);
            // snapshot = KIRI.api.view.snapshot;
        if (rotation) {
            widget._rotate(0,-rotation,0,true);
            widget.center();
        }
        slicing[widget.id] = callback;
        send("slice", {
            id: widget.id,
            settings: settings,
            vertices: vertices,
            position: widget.mesh.position,
            tracking: widget.track,
            // snapshot: snapshot,
            // for rotation / unrotation
            state: {
                rotation: rotation,
                centerz: centerz,
                movez: movez
            }
        }, function(reply) {
            if (reply.done || reply.error) {
                delete slicing[widget.id];
            }
            callback(reply);
        }, [vertices]);
    },

    prepare : function(settings, update, done) {
        send("prepare", { settings }, function(reply) {
            if (reply.progress) {
                update(reply.progress, reply.message);
            }
            if (reply.done) {
                done(reply.output, reply.maxSpeed);
            }
        });
    },

    export : function(settings, online, ondone) {
        send("export", { settings }, function(reply) {
            if (reply.line) {
                online(reply.line);
            }
            if (reply.done) {
                ondone(reply.output);
            }
        });
    },

    colors : function(colors, max, done) {
        send("colors", { colors, max }, function(reply) {
            done(reply);
        });
    },

    parse : function(args, progress, done) {
        // have to do this client side because DOMParser is not in workers
        if (args.type === 'svg') {
            const { settings, code, type } = args;
            const origin = settings.origin;
            const offset = {
                x: origin.x,
                y: -origin.y,
                z: origin.z
            };
            const output = KIRI.newPrint().parseSVG(code, offset);
            send("parse_svg", output, function(reply) {
                if (reply.parsed) {
                    done(KIRI.codec.decode(reply.parsed));
                }
            });
            return;
        }
        send("parse", args, function(reply) {
            if (reply.progress) {
                progress(reply);
            }
            if (reply.parsed) {
                done(KIRI.codec.decode(reply.parsed), reply.maxSpeed);
            }
        });
    }
};

// start worker
KIRI.work.restart();
