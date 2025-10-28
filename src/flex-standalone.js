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

        const originalDraw = drawer.draw.bind(drawer);
        drawer.draw = (function (tiledImages, size, view = undefined) {
            if (view) {
                const tiles = tiledImages.map(ti => ti.getTilesToDraw()).flat();
                const tasks = tiles.map(t => t.tile.getCache().prepareForRendering(drawer));

                return Promise.all(tasks).then(() => {
                    this.renderer.setDimensions(0, 0, size.width, size.height, tiledImages.length);
                    originalDraw(tiledImages, view);
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

            this.renderer.setDimensions(0, 0, size.width, size.height, tiledImages.length);
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

        }).bind(drawer);
        return drawer;
    };

}(OpenSeadragon));
