/** Copyright Stewart Allen <sa@grid.space> -- All Rights Reserved */

"use strict";

(function() {

    if (self.kiri.codec) return;

    const BASE = self.base, KIRI = self.kiri, handlers = {};

    const codec = KIRI.codec = {
        encode: encode,
        decode: decode,
        registerDecoder: registerDecoder,
        allocFloat32Array: allocFloat32Array
    };

    function allocFloat32Array(len) {
        if (Array.isArray(len)) {
            return new Float32Array(len);
        }
        return new Float32Array(len);
    }

    function encode(o, state) {
        state = state || {};
        if (o === null) return null;
        if (o === undefined) return undefined;
        if (Array.isArray(o)) {
            let arr = new Array(o.length), i=0;
            while (i < o.length) arr[i] = encode(o[i++], state);
            return arr;
        }
        switch (typeof(o)) {
            case 'string':
            case 'number':
                return o;
            case 'object':
                if (o.encode) return o.encode(state);
                return genOEncode(o, state);
        }
        return null;
    }

    function decode(o, state) {
        state = state || {};
        if (o === null) return null;
        if (o === undefined) return undefined;
        if (Array.isArray(o)) {
            for (let i=0; i < o.length; i++) o[i] = decode(o[i],state);
            return o;
        }
        switch (typeof(o)) {
            case 'string':
            case 'number':
                return o;
            case 'object':
                if (o.type && handlers[o.type]) return handlers[o.type](o,state);
                return genODecode(o, state);
        }
        return null;
    }

    function registerDecoder(type, handler) {
        handlers[type] = handler;
    }

    function genOEncode(o, state) {
        if (o instanceof Float32Array) return o;
        let out = {};
        for (let k in o) {
            if (o.hasOwnProperty(k)) out[k] = encode(o[k], state);
        }
        return out;
    }

    function genODecode(o, state) {
        if (o instanceof Float32Array) return o;
        let out = {};
        for (let k in o) {
            if (o.hasOwnProperty(k)) out[k] = decode(o[k], state);
        }
        return out;
    }

    /** ******************************************************************
     * Object CODEC Functions
     ******************************************************************* */

    KIRI.Slice.prototype.encode = function(state) {
        return {
            type: 'slice',
            z: this.z,
            index: this.index,
            render: encode(this.render, state)
        };
    };

    registerDecoder('slice', function(v, state) {
        let slice = KIRI.newSlice(v.z, state.mesh ? state.mesh.newGroup() : null);

        slice.index = v.index;
        slice.render = decode(v.render, state)

        return slice;
    });

    KIRI.Render.prototype.encode = function(state) {
        let enc = {
            type: 'render',
            layers: Object.keys(this.layers),
            data: Object.values(this.layers).map(layer => { return {
                polys: encode(layer.polys, state),
                lines: encodePointArray(layer.lines, state),
                faces: codec.allocFloat32Array(layer.faces),
                cface: layer.cface,
                color: layer.color,
                paths: layer.paths,
                cpath: layer.cpath,
                off: layer.off
            } })
        };
        return enc;
    };

    registerDecoder('render', function(v, state) {
        let render = new KIRI.Render();
        for (let i=0; i<v.layers.length; i++) {
            render.layers[v.layers[i]] = {
                polys: decode(v.data[i].polys, state),
                cpoly: v.data[i].cpoly,
                lines: decodePointArray(v.data[i].lines),
                faces: v.data[i].faces,
                cface: v.data[i].cface,
                color: v.data[i].color,
                paths: v.data[i].paths,
                cpath: v.data[i].cpath,
                off: v.data[i].off
            };
        }
        return render;
    });

    KIRI.Top.prototype.encode = function(state) {
        return {
            type: 'top',
            poly: encode(this.poly, state),
        };
    };

    registerDecoder('top', function(v, state) {
        let top = KIRI.newTop(decode(v.poly, state));
        return top;
    });

    function encodePointArray(points, state) {
        if (!points) return null;

        let array = codec.allocFloat32Array(points.length * 3),
            pos = 0;

        points.forEach(function(point) {
            if (state.rotate) {
                if (state.centerz) {
                    point.z -= state.centerz;
                }
                let v = new THREE.Vector3(point.x, point.y, point.z);
                v.applyMatrix4(state.rotate);
                point = {x: v.x, y: v.y, z: v.z};
                if (state.centerz) {
                    point.z += state.centerz;
                }
                if (state.movez) {
                    point.z -= state.movez;
                }
            }
            array[pos++] = point.x;
            array[pos++] = point.y;
            array[pos++] = point.z;
        });

        return array;
    }

    function decodePointArray(array) {
        if (!array) return null;

        let vid = 0,
            pid = 0,
            points = new Array(array.length/3);

        while (vid < array.length) {
            points[pid++] = BASE.newPoint(array[vid++], array[vid++], array[vid++]);
        }

        return points;
    }

    BASE.Polygon.prototype.encode = function(state) {
        if (!state.poly) state.poly = {};

        let cached = state.poly[this.id];

        if (cached) {
            return { type: 'poly', ref: this.id };
        }

        state.poly[this.id] = this;

        return {
            type: 'poly',
            id: this.id,
            array: encodePointArray(this.points, state),
            open: this.isOpen(),
            inner: encode(this.inner, state),
            parent: encode(this.parent, state),
            depth: this.depth,
            color: this.color
        };
    };

    registerDecoder('poly', function(v, state) {
        if (!state.poly) state.poly = {};

        if (v.ref) return state.poly[v.ref];

        let poly = BASE.newPolygon(),
            vid = 0;

        while (vid < v.array.length) {
            poly.push(BASE.newPoint(v.array[vid++], v.array[vid++], v.array[vid++]));
        }

        poly.id = v.id;
        poly.open = v.open;

        state.poly[v.id] = poly;

        poly.inner = decode(v.inner, state);
        poly.parent = decode(v.parent, state);
        poly.depth = v.depth;
        poly.color = v.color;

        return poly;
    });


})();
