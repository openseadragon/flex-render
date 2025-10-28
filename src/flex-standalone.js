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

        let locked = false;
        const waiters = [];
        const lock = async() => {
            if (!locked) {
                locked = true;
                return;
            }
            await new $.Promise(resolve => waiters.push(resolve));
        };
        const unlock = () => {
            const next = waiters.shift();
            if (next) {
                next();
            } else {
                locked = false;
            }
        };

        /**
         * Draws the viewer with the given configuration.
         * @param {Array<OpenSeadragon.TiledImage>} tiledImages - The tiled images to draw.
         * @param {Object.<string, ShaderConfig>} configuration - map of id -> shader config value
         * @param {OpenSeadragon.Point} size - The size of the viewer
         * @param {object} view - The viewport to draw, see {@link OpenSeadragon.FlexDrawer#draw}
         * @returns {Promise<CanvasRenderingContext2D>}
         */
        drawer.drawWithConfiguration = (async function (tiledImages, configuration, size, view = undefined) {
            // do not block preprocessing if necessary, custom view requires tiles -> ensure tiles are supported
            let tiles;
            let tasks;
            if (view) {
                tiles = tiledImages.map(ti => ti.getTilesToDraw()).flat();
                tasks = tiles.map(t => t.tile.getCache().prepareForRendering(drawer));
            }

            await lock();
            try {
                if (configuration) {
                    await drawer.overrideConfigureAll(configuration);
                }

                if (view) {
                    return Promise.all(tasks).then(() => {
                        this.renderer.setDimensions(0, 0, size.x, size.y, tiledImages.length);
                        this.draw(tiledImages, view);
                        const canvas = document.createElement('canvas');
                        const ctx = canvas.getContext('2d');
                        canvas.width = this.renderer.canvas.width;
                        canvas.height = this.renderer.canvas.height;
                        ctx.drawImage(this.renderer.canvas, 0, 0);
                        return ctx;
                    }).catch(e => console.error(e)).finally(() => {
                        // free data
                        const dId = drawer.getId();
                        tiles.forEach(t => t.tile.getCache().destroyInternalCache(dId));
                    });
                }

                this.renderer.setDimensions(0, 0, size.x, size.y, tiledImages.length);
                // Steal FP initialized textures
                if (!this.renderer.__firstPassResult) {
                    // todo dirty, hide the __firstPassResult structure within the program logics
                    const program = this.renderer.getProgram('firstPass');
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
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                canvas.width = this.renderer.canvas.width;
                canvas.height = this.renderer.canvas.height;
                ctx.drawImage(this.renderer.canvas, 0, 0);
                return ctx;
            } finally {
                unlock();
            }
        }).bind(drawer);
        return drawer;
    };

}(OpenSeadragon));
