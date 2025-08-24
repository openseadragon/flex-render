(function($) {

    $.makeStandaloneFlexDrawer = function(viewer) {
        const Drawer = OpenSeadragon.FlexDrawer;

        const options = $.extend(true, {}, viewer.drawerOptions[Drawer.prototype.getType()]);
        options.debug = false;
        options.htmlReset = undefined;
        options.htmlHandler = undefined;
        // avoid modification on navigator
        options.handleNavigator = false;
        options.offScreen = true;

        const drawer = new Drawer({
            viewer:             viewer,
            viewport:           viewer.viewport,
            element:            viewer.drawer.container,
            debugGridColor:     viewer.debugGridColor,
            options:            options
        });

        drawer.draw = (function (tiledImages) {
            // Steal FP initialized textures
            if (!this.renderer.__firstPassResult) {
                // todo dirty, hide the __firstPassResult structure within the program logics
                const program = this.renderer.getProgram('firstPass');
                console.log("Stealing first pass result from the renderer: ", program.colorTextureA, program.stencilTextureA);
                this.renderer.__firstPassResult = {
                    texture: program.colorTextureA,
                    stencil: program.stencilTextureA,
                };
            }

            // Instead of re-rendering, we steal last state of the renderer and re-render second pass only.
            viewer.drawer.renderer.copyRenderOutputToContext(this.renderer);
            this._drawTwoPassSecond({
                zoom: this.viewport.getZoom(true)
            });

            // const sources = [];
            // const shaders = this.renderer.getAllShaders();
            // for (let shaderID of this.renderer.getShaderLayerOrder()) {
            //     const shader = shaders[shaderID];
            //     const config = shader.getConfig();
            //
            //     // Here we could do some nicer logics, RN we just treat TI0 as a source of truth
            //     const tiledImage = this.viewer.world.getItemAt(config.tiledImages[0]);
            //     sources.push({
            //         zoom: viewport.zoom,
            //         pixelSize: tiledImage ? this._tiledImageViewportToImageZoom(tiledImage, viewport.zoom) : 1,
            //         opacity: tiledImage ? tiledImage.getOpacity() : 1,
            //         shader: shader
            //     });
            // }
            //
            // if (!sources.length) {
            //     this.viewer.forceRedraw();
            //     return;
            // }
            //
            // this.renderer.secondPassProcessData(drawFirstPass, sources);

        }).bind(drawer);
        return drawer;

        // todo consider generic solution for all drawers like this (might be hard to do though...)
        // const freeTileMap = {};

        //
        // const drawCall = drawer.draw.bind(drawer);
        // drawer.draw = function (tiledImages) {
        //     throw Error("Standalone drawer cannot draw: use async offScreenDraw() instead.");
        // };
        //
        // drawer.offScreenDraw = async function (tiledImages) {
        //     const drawStamp = Date.now();
        //     for (const image of tiledImages) {
        //         const tileList = image.getTilesToDraw();
        //
        //         for (const tileSpec of tileList) {
        //             const cache = tileSpec.tile.getCache();
        //             const iCacheRef = cache._getInternalCacheRef(drawer);
        //             if (!iCacheRef) {
        //                 await cache.prepareInternalCacheAsync(drawer);
        //                 freeTileMap[tileSpec.tile.cacheKey] = drawStamp;
        //             }
        //         }
        //     }
        //
        //     // Free old data
        //     const drawerId = drawer.getId();
        //     for (let key in freeTileMap) {
        //         const stamp = freeTileMap[key];
        //         if (stamp < drawStamp) {
        //             const cache = viewer.tileCache.getCacheRecord(key);
        //             if (cache && cache.loaded) {
        //                 cache.destroyInternalCache(drawerId);
        //             }
        //             delete freeTileMap[key];
        //         }
        //     }
        //
        //     drawCall(tiledImages);
        // };
        // return drawer;
    };

}(OpenSeadragon));
