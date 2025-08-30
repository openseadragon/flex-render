(function ($) {
/**
 * MVTTileJSONSource
 * ------------------
 * A TileSource that reads TileJSON metadata, fetches MVT (.mvt/.pbf) tiles,
 * decodes + tessellates them on a Web Worker, and returns FlexDrawer-compatible
 * caches using the new `vector-mesh` format (fills + lines).
 *
 * Requirements:
 *  - flex-drawer.js patched to accept `vector-mesh` (see vector-mesh-support.patch)
 *  - flex-webgl2.js patched to draw geometry in first pass (see flex-webgl2-vector-pass.patch)
 *
 * Usage:
 *   const src = await OpenSeadragon.MVTTileJSONSource.from(
 *     'https://tiles.example.com/basemap.json',
 *     { style: defaultStyle() }
 *   );
 *   viewer.addTiledImage({ tileSource: src });
 *
 * Usage (local server for testing via docker):
 *     Download desired vector tiles from the server, and run:
 *       docker run -it --rm -p 8080:8080 -v /path/to/data:/data maptiler/tileserver-gl-light:latest
 *
 * Alternatives (not supported):
 *      PMTiles range queries
 *      Raw files: pip install mbutil && mb-util --image_format=pbf mytiles.mbtiles ./tiles
 *
 *
 * TODO OSD uses // eslint-disable-next-line compat/compat to disable URL warns for opera mini - what is the purpose of supporting it at all
 */
$.MVTTileSource = class extends $.TileSource {
    constructor({ template, scheme = 'xyz', tileSize = 512, minLevel = 0, maxLevel = 14, width, height, extent = 4096, style }) {
        super({ width, height, tileSize, minLevel, maxLevel });
        this.template = template;
        this.scheme = scheme;
        this.extent = extent;
        this.style = style || defaultStyle();
        this._worker = makeWorker();
        this._pending = new Map(); // key -> {resolve,reject}

        // Wire worker responses
        this._worker.onmessage = (e) => {
            const msg = e.data;
            if (!msg || !msg.key) {
                return;
            }

            const waiters = this._pending.get(msg.key);
            if (!waiters) {
                return;
            }
            this._pending.delete(msg.key);

            if (msg.ok) {
                const t = msg.data;
                for (const ctx of waiters) {
                    ctx.finish({
                        fills: t.fills.map(packMesh),
                        lines: t.lines.map(packMesh)
                    }, undefined, 'vector-mesh');
                }
            } else {
                for (const ctx of waiters) {
                    ctx.fail(msg.error || 'Worker failed');
                }
            }
        };

        // Send config once
        this._worker.postMessage({ type: 'config', extent: this.extent, style: this.style });
    }

    /**
     * Determine if the data and/or url imply the image service is supported by
     * this tile source.
     * @function
     * @param {Object|Array} data
     * @param {String} url - optional
     */
    supports(data, url) {
        return data["tiles"] && data["format"] === "pbf" && url.endsWith(".json");
    }
    /**
     *
     * @function
     * @param {Object} data - the options
     * @param {String} dataUrl - the url the image was retrieved from, if any.
     * @param {String} postData - HTTP POST data in k=v&k2=v2... form or null
     * @returns {Object} options - A dictionary of keyword arguments sufficient
     *      to configure this tile sources constructor.
     */
    configure(data, dataUrl, postData) {
        const tj = data;

        // Basic TileJSON fields
        const tiles = (tj.tiles && tj.tiles.length) ? tj.tiles : (tj.tilesURL ? [tj.tilesURL] : null);
        if (!tiles) {
            throw new Error('TileJSON missing tiles template');
        }
        const template = tiles[0];
        const tileSize = tj.tileSize || 512;  // many vector tile sets use 512
        const minLevel = tj.minzoom ? tj.minzoom : 0;
        const maxLevel = tj.maxzoom ? tj.maxzoom : 14;
        const scheme = tj.scheme || 'xyz'; // 'xyz' or 'tms'
        const extent = (tj.extent && Number.isFinite(tj.extent)) ? tj.extent : 4096;

        const width = Math.pow(2, maxLevel) * tileSize;
        const height = width;

        return {
            template,
            scheme,
            tileSize,
            minLevel,
            maxLevel,
            width,
            height,
            extent,
            style: defaultStyle(),  // todo style
        };
    }

    getTileUrl(level, x, y) {
        const z = level;
        const n = 1 << z;
        const ty = (this.scheme === 'tms') ? (n - 1 - y) : y;
        return this.template.replace('{z}', z).replace('{x}', x).replace('{y}', ty);
    }

    /**
     * Return a FlexDrawer cache object directly (vector-mesh).
     */
    downloadTileStart(context) {
        const tile = context.tile;
        const key = context.src;

        const list = this._pending.get(key);
        if (list) {
            list.push(context);
        } else {
            this._pending.set(key, [ context ]);
        }

        this._worker.postMessage({
            type: 'tile',
            key: key,
            z: tile.level,
            x: tile.x,
            y: tile.y,
            url: context.src
        });
    }
};

// ---------- Helpers ----------

function packMesh(m) {
    return {
        vertices: new Float32Array(m.vertices),
        indices: new Uint32Array(m.indices),
        color: m.color || [1, 0, 0, 1],
    };
}

function defaultStyle() {
    // Super-minimal style mapping; replace as needed.
    // layerName => {type:'fill'|'line', color:[r,g,b,a], widthPx?:number, join?:'miter'|'bevel'|'round', cap?:'butt'|'square'|'round'}
    return {
        layers: {
            water:     { type: 'fill', color: [0.65, 0.80, 0.93, 1] },
            landuse:   { type: 'fill', color: [0.95, 0.94, 0.91, 1] },
            park:      { type: 'fill', color: [0.88, 0.95, 0.88, 1] },
            building:  { type: 'fill', color: [0.93, 0.93, 0.93, 1] },
            waterway:  { type: 'line', color: [0.55, 0.75, 0.90, 1], widthPx: 1.2, join: 'round', cap: 'round' },
            road:      { type: 'line', color: [0.60, 0.60, 0.60, 1], widthPx: 1.5, join: 'round', cap: 'round' },
        },
        // Default if layer not listed
        fallback: { type: 'line', color: [0.3, 0.3, 0.3, 1], widthPx: 1, join: 'bevel', cap: 'butt' }
    };
}

function makeWorker() {
    // Prefer the inlined source if available
    const inline = (OpenSeadragon && OpenSeadragon.__MVT_WORKER_SOURCE__);
    if (inline) {
        const blob = new Blob([inline], { type: "text/javascript" });
        return new Worker((window.URL || window.webkitURL).createObjectURL(blob));
    }

    throw new Error('No worker source available');
}

})(OpenSeadragon);
