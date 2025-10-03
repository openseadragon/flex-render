(function($) {
    /**
     * @typedef {Object} ShaderConfig
     * @property {String} shaderConfig.id
     * @property {String} shaderConfig.name
     * @property {String} shaderConfig.type         equal to ShaderLayer.type(), e.g. "identity"
     * @property {Number} shaderConfig.visible      1 = use for rendering, 0 = do not use for rendering
     * @property {Boolean} shaderConfig.fixed
     * @property {Object} shaderConfig.params          settings for the ShaderLayer
     * @property {OpenSeadragon.TiledImage[]|number[]} tiledImages images that provide the data
     * @property {Object} shaderConfig._controls       storage for the ShaderLayer's controls
     * @property {Object} shaderConfig.cache          cache object used by the ShaderLayer's controls
     */

    /**
     * @typedef {Object} FPRenderPackageItem
     * @property {WebGLTexture[]} texture           [TEXTURE_2D]
     * @property {Float32Array} textureCoords
     * @property {Float32Array} transformMatrix
     * //todo provide also opacity per tile?
     */

    /**
     * @typedef {Object} FPRenderPackage
     * @property {FPRenderPackageItem} tiles
     * @property {Number[][]} stencilPolygons
     */

    /**
     * @typedef {Object} SPRenderPackage
     * @property {Number} zoom
     * @property {Number} pixelsize
     * @property {Number} opacity
     * @property {ShaderLayer} shader
     * @property {Uint8Array|undefined} iccLut  TODO also support error rendering by passing some icon texture & rendering where nothing was rendered but should be (-> use mask, but how we force tiles to come to render if they are failed?  )
     */

    /**
     * @typedef HTMLControlsHandler
     * Function that attaches HTML controls for ShaderLayer's controls to DOM.
     * @type function
     * @param {OpenSeadragon.FlexRenderer.ShaderLayer} [shaderLayer]
     * @param {ShaderConfig} [shaderConfig]
     * @returns {String}
     */

    /**
     * @typedef {Object} RenderOutput
     * @property {Number} sourcesLength
     */

    /**
     * WebGL Renderer for OpenSeadragon.
     *
     * Renders in two passes:
     *  1st pass joins tiles and creates masks where we should draw
     *  2nd pass draws the actual data using shaders
     *
     * @property {RegExp} idPattern
     * @property {Object} BLEND_MODE
     *
     * @class OpenSeadragon.FlexRenderer
     * @classdesc class that manages ShaderLayers, their controls, and WebGLContext to allow rendering using WebGL
     * @memberof OpenSeadragon
     */
    $.FlexRenderer = class extends $.EventSource {

        /**
         * @param {Object} incomingOptions
         *
         * @param {String} incomingOptions.uniqueId
         *
         * @param {String} incomingOptions.webGLPreferredVersion    prefered WebGL version, "1.0" or "2.0"
         *
         * @param {Function} incomingOptions.redrawCallback          function called when user input changed; triggers re-render of the viewport
         * @param {Function} incomingOptions.refetchCallback        function called when underlying data changed; triggers re-initialization of the whole WebGLDrawer
         * @param {Boolean} incomingOptions.debug                   debug mode on/off
         * @param {Boolean} incomingOptions.interactive             if true (default), the layers are configured for interactive changes (not applied by default)
         * @param {HTMLControlsHandler} incomingOptions.htmlHandler function that ensures individual ShaderLayer's controls' HTML is properly present at DOM
         * @param {function} incomingOptions.htmlReset              callback called when a program is reset - html needs to be cleaned
         *
         * @param {Object} incomingOptions.canvasOptions
         * @param {Boolean} incomingOptions.canvasOptions.alpha
         * @param {Boolean} incomingOptions.canvasOptions.premultipliedAlpha
         * @param {Boolean} incomingOptions.canvasOptions.stencil
         *
         * @constructor
         * @memberof FlexRenderer
         */
        constructor(incomingOptions) {
            super();

            if (!this.constructor.idPattern.test(incomingOptions.uniqueId)) {
                throw new Error("$.FlexRenderer::constructor: invalid ID! Id can contain only letters, numbers and underscore. ID: " + incomingOptions.uniqueId);
            }
            this.uniqueId = incomingOptions.uniqueId;

            this.webGLPreferredVersion = incomingOptions.webGLPreferredVersion;

            this.redrawCallback = incomingOptions.redrawCallback;
            this.refetchCallback = incomingOptions.refetchCallback;
            this.debug = incomingOptions.debug;
            this.interactive = incomingOptions.interactive === undefined ?
                !!incomingOptions.htmlHandler : !!incomingOptions.interactive;
            this.htmlHandler = this.interactive ? incomingOptions.htmlHandler : null;

            if (this.htmlHandler) {
                if (!incomingOptions.htmlReset) {
                    throw Error("$.FlexRenderer::constructor: htmlReset callback is required when htmlHandler is set!");
                }
                this.htmlReset = incomingOptions.htmlReset;
            } else {
                this.htmlReset = () => {};
            }

            this.running = false;
            this._program = null;            // WebGLProgram
            this._shaders = {};
            this._shadersOrder = null;
            this._programImplementations = {};
            this.__firstPassResult = null;

            this.canvasContextOptions = incomingOptions.canvasOptions;
            const canvas = document.createElement("canvas");
            const WebGLImplementation = this.constructor.determineContext(this.webGLPreferredVersion);
            const webGLRenderingContext = $.FlexRenderer.WebGLImplementation.createWebglContext(canvas, this.webGLPreferredVersion, this.canvasContextOptions);
            if (webGLRenderingContext) {
                this.gl = webGLRenderingContext;                                            // WebGLRenderingContext|WebGL2RenderingContext
                this.webglContext = new WebGLImplementation(this, webGLRenderingContext);   // $.FlexRenderer.WebGLImplementation
                this.canvas = canvas;

                // Should be last call of the constructor to make sure everything is initialized
                this.webglContext.init();
            } else {
                throw new Error("$.FlexRenderer::constructor: Could not create WebGLRenderingContext!");
            }
        }

        /**
         * Search through all FlexRenderer properties to find one that extends WebGLImplementation and it's getVersion() method returns <version> input parameter.
         * @param {String} version WebGL version, "1.0" or "2.0"
         * @returns {WebGLImplementation}
         *
         * @instance
         * @memberof FlexRenderer
         */
        static determineContext(version) {
            const namespace = $.FlexRenderer;
            for (let property in namespace) {
                const context = namespace[ property ],
                    proto = context.prototype;
                if (proto && proto instanceof namespace.WebGLImplementation &&
                    $.isFunction( proto.getVersion ) && proto.getVersion.call( context ) === version) {
                        return context;
                }
            }

            throw new Error("$.FlexRenderer::determineContext: Could not find WebGLImplementation with version " + version);
        }

        /**
         * Get Currently used WebGL version
         * @return {String|*}
         */
        get webglVersion() {
            return this.webglContext.webGLVersion;
        }

        /**
         * Set viewport dimensions.
         * @param {Number} x
         * @param {Number} y
         * @param {Number} width
         * @param {Number} height
         * @param {Number} levels number of layers that are rendered, kind of 'depth' parameter, an integer
         *
         * @instance
         * @memberof FlexRenderer
         */
        setDimensions(x, y, width, height, levels) {
            this.canvas.width = width;
            this.canvas.height = height;
            this.gl.viewport(x, y, width, height);
            this.webglContext.setDimensions(x, y, width, height, levels);
        }

        /**
         * Whether the FlexRenderer creates HTML elements in the DOM for ShaderLayers' controls.
         * @return {Boolean}
         *
         * @instance
         * @memberof FlexRenderer
         */
        supportsHtmlControls() {
            return typeof this.htmlHandler === "function";
        }

        /**
         * Call to first-pass draw using WebGLProgram.
         * @param {FPRenderPackage[]} source
         * @return {RenderOutput}
         * @instance
         * @memberof FlexRenderer
         */
        firstPassProcessData(source) {
            const program = this._programImplementations[this.webglContext.firstPassProgramKey];
            if (this.useProgram(program, "first-pass")) {
                program.load();
            }
            const result = program.use(this.__firstPassResult, source);
            if (this.debug) {
                this._showOffscreenMatrix(result, source.length, {scale: 0.5, pad: 8});
            }
            this.__firstPassResult = result;
            this.__firstPassResult.sourcesLength = source.length;
            return result;
        }

        /**
         * Call to second-pass draw
         * @param {SPRenderPackage[]} renderArray
         * @return {RenderOutput}
         */
        secondPassProcessData(renderArray) {
            const program = this._programImplementations[this.webglContext.secondPassProgramKey];
            if (this.useProgram(program, "second-pass")) {
                program.load(renderArray);
            }
            return program.use(this.__firstPassResult, renderArray);
        }

        /**
         * Create and load the new WebGLProgram based on ShaderLayers and their controls.
         * @param {OpenSeadragon.FlexRenderer.Program} program
         * @param {String} [key] optional ID for the program to use
         * @return {String} ID for the program it was registered with
         *
         * @instance
         * @protected
         * @memberof FlexRenderer
         */
        registerProgram(program, key = undefined) {
            key = key || String(Date.now());

            if (!program) {
                program = this._programImplementations[key];
            }
            if (this._programImplementations[key]) {
                this.deleteProgram(key);
            }

            const webglProgram = this.gl.createProgram();
            program._webGLProgram = webglProgram;

            // TODO inner control type udpates are not checked here
            for (let shaderId in this._shaders) {
                const shader = this._shaders[shaderId];
                const config = shader.getConfig();
                // Check explicitly type of the config, if updated, recreate shader
                if (shader.constructor.type() !== config.type) {
                    this.createShaderLayer(shaderId, config, false);
                }
            }

            program.build(this._shaders, this.getShaderLayerOrder());
            // Used also to re-compile, set requiresLoad to true
            program.requiresLoad = true;

            const errMsg = program.getValidateErrorMessage();
            if (errMsg) {
                this.gl.deleteProgram(webglProgram);
                program._webGLProgram = null;
                throw Error(errMsg);
            }

            this._programImplementations[key] = program;
            if ($.FlexRenderer.WebGLImplementation._compileProgram(
                webglProgram, this.gl, program, $.console.error, this.debug
            )) {
                this.gl.useProgram(webglProgram);
                program.created(webglProgram, this.canvas.width, this.canvas.height);
                return key;
            }
            return undefined;
        }

        /**
         * Switch program
         * @param {OpenSeadragon.FlexRenderer.Program|string} program instance or program key to use
         * @param {string} name "first-pass" or "second-pass"
         * @return {boolean} false if update is not necessary, true if update was necessary -- updates
         * are initialization steps taken once after program is first loaded (after compilation)
         * or when explicitly re-requested
         */
        useProgram(program, name) {
            if (!(program instanceof $.FlexRenderer.Program)) {
                program = this.getProgram(program);
            }

            if (this.running && this._program === program) {
                return false;
            } else if (this._program) {
                this._program.unload();
            }

            this._program = program;
            this.gl.useProgram(program.webGLProgram);

            const needsUpdate = this._program.requiresLoad;
            this._program.requiresLoad = false;
            if (needsUpdate) {
                /**
                 * todo better docs
                 * Fired after program has been switched to (initially or when changed).
                 * The event happens BEFORE JS logics executes within ShaderLayers.
                 * @event program-used
                 */
                this.raiseEvent('program-used', {
                    name: name,
                    program: program,
                    shaderLayers: this._shaders,
                });

                // initialize ShaderLayer's controls:
                //      - set their values to default,
                //      - if interactive register event handlers to their corresponding DOM elements created in the previous step

                //todo a bit dirty.. consider events / consider doing within webgl context
                if (name === "second-pass") {
                    // generate HTML elements for ShaderLayer's controls and put them into the DOM
                    if (this.htmlHandler) {
                        this.htmlReset();

                        for (const shaderId of this.getShaderLayerOrder()) {
                            const shaderLayer = this._shaders[shaderId];
                            const shaderConfig = shaderLayer.__shaderConfig;
                            this.htmlHandler(
                                shaderLayer,
                                shaderConfig
                            );
                        }

                        this.raiseEvent('html-controls-created', {
                            name: name,
                            program: program,
                            shaderLayers: this._shaders,
                        });
                    }

                    for (const shaderId in this._shaders) {
                        this._shaders[shaderId].init();
                    }
                }
            }

            if (!this.running) {
                this.running = true;
            }
            return needsUpdate;
        }

        /**
         *
         * @param {string} programKey
         * @return {OpenSeadragon.FlexRenderer.Program}
         */
        getProgram(programKey) {
            return this._programImplementations[programKey];
        }

        /**
         *
         * @param {string} key program key to delete
         */
        deleteProgram(key) {
            const implementation = this._programImplementations[key];
            if (!implementation) {
                return;
            }
            implementation.unload();
            implementation.destroy();
            this.gl.deleteProgram(implementation._webGLProgram);
            this.__firstPassResult = null;
            this._programImplementations[key] = null;
        }

        /**
         * Create and initialize new ShaderLayer instantion and its controls.
         * @param id
         * @param {ShaderConfig} shaderConfig object bound to a concrete ShaderLayer instance
         * @param {boolean} [copyConfig=false] if true, deep copy of the config is used to avoid modification of the parameter
         * @returns {ShaderLayer} instance of the created shaderLayer
         *
         * @instance
         * @memberof FlexRenderer
         */
        createShaderLayer(id, shaderConfig, copyConfig = false) {
            id = $.FlexRenderer.sanitizeKey(id);

            const Shader = $.FlexRenderer.ShaderMediator.getClass(shaderConfig.type);
            if (!Shader) {
                throw new Error(`$.FlexRenderer::createShaderLayer: Unknown shader type '${shaderConfig.type}'!`);
            }

            const defaultConfig = {
                id: id,
                name: "Layer",
                type: "identity",
                visible: 1,
                fixed: false,
                tiledImages: [0],
                params: {},
                cache: {},
            };
            if (copyConfig) {
                // Deep copy to avoid modification propagation
                shaderConfig = $.extend(true, defaultConfig, shaderConfig);
            } else {
                // Ensure we keep references where possible -> this will make shader object within drawers (e.g. navigator VS main)
                for (let propName in defaultConfig) {
                    if (shaderConfig[propName] === undefined) {
                        shaderConfig[propName] = defaultConfig[propName];
                    }
                }
            }

            if (this._shaders[id]) {
                this.removeShader(id);
            }

            // TODO a bit dirty approach, make the program key usable from outside
            const shader = new Shader(id, {
                shaderConfig: shaderConfig,
                webglContext: this.webglContext,
                params: shaderConfig.params,
                interactive: this.interactive,

                // callback to re-render the viewport
                invalidate: this.redrawCallback,
                // callback to rebuild the WebGL program
                rebuild: () => {
                    this.registerProgram(null, this.webglContext.secondPassProgramKey);
                },
                // callback to reinitialize the drawer; NOT USED
                refetch: this.refetchCallback
            });

            shader.construct();
            this._shaders[id] = shader;
            return shader;
        }

        getAllShaders() {
            return this._shaders;
        }

        getShaderLayer(id) {
            id = $.FlexRenderer.sanitizeKey(id);
            return this._shaders[id];
        }

        getShaderLayerConfig(id) {
            const shader = this.getShaderLayer(id);
            if (shader) {
                return shader.getConfig();
            }
            return undefined;
        }

        /**
         *
         * @param order
         */
        setShaderLayerOrder(order) {
            if (!order) {
                this._shadersOrder = null;
            }
            this._shadersOrder = order.map($.FlexRenderer.sanitizeKey);
        }

        /**
         *
         * Retrieve the order
         * @return {*}
         */
        getShaderLayerOrder() {
            return this._shadersOrder || Object.keys(this._shaders);
        }

        /**
         * Remove ShaderLayer instantion and its controls.
         * @param {string} id shader id
         *
         * @instance
         * @memberof FlexRenderer
         */
        removeShader(id) {
            id = $.FlexRenderer.sanitizeKey(id);
            const shader = this._shaders[id];
            if (!shader) {
                return;
            }
            shader.destroy();
            delete this._shaders[id];
        }

        /**
         * Clear all shaders
         */
        deleteShaders() {
            for (let sId in this._shaders) {
                this.removeShader(sId);
            }
        }

        /**
         * @param {Boolean} enabled if true enable alpha blending, otherwise disable blending
         *
         * @instance
         * @memberof FlexRenderer
         */
        setDataBlendingEnabled(enabled) {
            if (enabled) {
                this.gl.enable(this.gl.BLEND);

                // standard alpha blending
                this.gl.blendFunc(this.gl.ONE, this.gl.ONE_MINUS_SRC_ALPHA);
            } else {
                this.gl.disable(this.gl.BLEND);
            }
        }

        destroy() {
            this.htmlReset();
            this.deleteShaders();
            for (let pId in this._programImplementations) {
                this.deleteProgram(pId);
            }
            this.webglContext.destroy();
            this._programImplementations = {};
        }

        static sanitizeKey(key) {
            if (!$.FlexRenderer.idPattern.test(key)) {
                key = key.replace(/[^0-9a-zA-Z_]/g, '');
                key = key.replace(/_+/g, '_');
                key = key.replace(/^_+/, '');

                if (!key) {
                    throw new Error("Invalid key: sanitization removed all parts!");
                }
            }
            return key;
        }

        // Todo below are debug and other utilities hardcoded for WebGL2. In case of other engines support, these methods
        //  must be adjusted or moved to appropriate interfaces

        /**
         * Convenience: copy your RenderOutput {texture, stencil} to desination.
         * Returns { texture: WebGLTexture, stencil: WebGLTexture } in the destination context.
         *
         * @param {OpenSeadragon.FlexRenderer} dst
         * @param {RenderOutput} [renderOutput]  first pass output to copy, defaults to latest internal state
         * @param {Object} [opts]  options
         * @return {RenderOutput}
         */
        copyRenderOutputToContext(dst, renderOutput = undefined, {
            level = 0,
            format = null,
            type = null,
            internalFormatGuess = null,
        } = {}) {
            renderOutput = renderOutput || this.__firstPassResult;
            const out = {};
            if (renderOutput.texture) {
                out.texture = this._copyTexture2DArrayBetweenContexts({
                    dstGL: dst.gl, srcTex: renderOutput.texture, dstTex: dst.__firstPassResult.texture,
                    textureLayerCount: renderOutput.sourcesLength, format, type, internalFormatGuess,
                });
            }
            if (renderOutput.stencil) {
                out.stencil = this._copyTexture2DArrayBetweenContexts({
                    dstGL: dst.gl, srcTex: renderOutput.stencil, dstTex: dst.__firstPassResult.stencil,
                    textureLayerCount: renderOutput.sourcesLength, format, type, internalFormatGuess,
                });
            }
            out.sourcesLength = renderOutput.sourcesLength || 0;
            dst.__firstPassResult = out;
            return out;
        }

        /**
         * Copy a TEXTURE_2D_ARRAY from one WebGL2 context to another by readPixels -> texSubImage3D.
         * Creates the destination texture if not provided.
         *
         * @param {Object} opts
         * @param {WebGL2RenderingContext} opts.dstGL
         * @param {WebGLTexture} opts.srcTex           - source TEXTURE_2D_ARRAY
         * @param {WebGLTexture?} [opts.dstTex]        - optional destination TEXTURE_2D_ARRAY (created if omitted)
         * @param {number} [opts.level=0]              - mip level to copy
         * @param {GLenum} [opts.format=srcGL.RGBA]    - pixel format for read/upload
         * @param {GLenum} [opts.type=srcGL.UNSIGNED_BYTE]  - pixel type for read/upload (supports srcGL.FLOAT if you have the extensions)
         * @param {GLenum} [opts.internalFormatGuess]  - sized internal format for dst allocation (defaults to RGBA8 for UNSIGNED_BYTE, RGBA32F for FLOAT)
         * @returns {WebGLTexture} dstTex
         */
        _copyTexture2DArrayBetweenContexts({ dstGL, srcTex, dstTex = null,
               textureLayerCount, format = null, type = null, internalFormatGuess = null }) {
            const gl = this.gl;
            if (!(gl instanceof WebGL2RenderingContext) || !(dstGL instanceof WebGL2RenderingContext)) {
                throw new Error('WebGL2 contexts required (texture arrays + tex(Sub)Image3D).');
            }

            // ---------- Inspect source texture dimensions ----------
           // const srcPrevTex = gl.getParameter(gl.TEXTURE_BINDING_2D_ARRAY);
            gl.bindTexture(gl.TEXTURE_2D_ARRAY, srcTex);

            if (format === null) {
                format = gl.RGBA;
            }
            if (type === null) {
                type = gl.UNSIGNED_BYTE;
            }

            const width  = this.canvas.width;
            const height = this.canvas.height;
            if (!width || !height || !textureLayerCount) {
                // gl.bindTexture(gl.TEXTURE_2D_ARRAY, srcPrevTex);
                throw new Error('Source texture level has no width/height/layers (is it initialized?)');
            }

            // ---------- Create + allocate destination texture if needed ----------
            //const dstPrevTex = dstGL.getParameter(dstGL.TEXTURE_BINDING_2D_ARRAY);
            dstGL.bindTexture(dstGL.TEXTURE_2D_ARRAY, dstTex);

            // todo cache fb
            const srcFB = gl.createFramebuffer();
            gl.bindFramebuffer(gl.FRAMEBUFFER, srcFB);

            // ---------- Prepare source framebuffer for extraction ----------
            // const srcPrevFB = gl.getParameter(gl.FRAMEBUFFER_BINDING);

            const layerByteLen = width * height * 4 * (type === gl.FLOAT ? 4 : 1);
            const layerBuf = (type === gl.FLOAT) ? new Float32Array(layerByteLen / 4) : new Uint8Array(layerByteLen);

            for (let z = 0; z < textureLayerCount; z++) {
                gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, srcTex, 0, z);
                const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
                if (status !== gl.FRAMEBUFFER_COMPLETE) {
                    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
                    gl.deleteFramebuffer(srcFB);
                    // gl.bindTexture(gl.TEXTURE_2D_ARRAY, srcPrevTex);
                    // dstGL.bindTexture(dstGL.TEXTURE_2D_ARRAY, dstPrevTex);
                    throw new Error(`Framebuffer incomplete for source layer ${z}: 0x${status.toString(16)}`);
                }

                gl.readPixels(0, 0, width, height, format, type, layerBuf);
                dstGL.texSubImage3D(
                    dstGL.TEXTURE_2D_ARRAY, 0,
                    0, 0, z,
                    width, height, 1,
                    format, type,
                    layerBuf
                );
            }

            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.deleteFramebuffer(srcFB);
            // gl.bindTexture(gl.TEXTURE_2D_ARRAY, srcPrevTex);
            // dstGL.bindTexture(dstGL.TEXTURE_2D_ARRAY, dstPrevTex);
            return dstTex;
        }

        _showOffscreenMatrix(renderOutput, length, {
            scale = 1,
            pad = 8,
            drawLabels = true,
            background = '#111'
        } = {}) {
            // 2 columns: [Texture, Stencil], `length` rows
            const cols = 2;
            const rows = length;
            const width = Math.floor(this.canvas.width);
            const height = Math.floor(this.canvas.height);
            const cellW = Math.floor(width * scale);
            const cellH = Math.floor(height * scale);
            const totalW = pad + cols * (cellW + pad);
            const totalH = pad + rows * (cellH + pad) + (drawLabels ? 18 : 0);

            const dbg = this._openDebugWindowFromUserGesture(totalW, totalH, 'Offscreen Layers (Texture | Stencil)');
            if (!dbg) {
                console.warn('Could not open debug window');
                return;
            }

            const gl = this.gl;
            const isGL2 = (gl instanceof WebGL2RenderingContext) || this.webGLVersion === "2.0";

            const ctx = dbg.__debugCtx;
            ctx.fillStyle = background;
            ctx.fillRect(0, 0, totalW, totalH);
            ctx.imageSmoothingEnabled = false;

            // Optional headers
            if (drawLabels) {
                ctx.fillStyle = '#ddd';
                ctx.font = '12px system-ui';
                ctx.textBaseline = 'top';
                const yLbl = 2;
                const x0 = pad;
                const x1 = pad + (cellW + pad);
                ctx.fillText('Texture', x0, yLbl);
                ctx.fillText('Stencil', x1, yLbl);
            }

            // Prepare a tiny staging canvas so we can draw the pixels into 2D easily
            // and then scale when drawing to the popup.
            if (!this._debugStage) {
                this._debugStage = document.createElement('canvas');
            }
            const stage = this._debugStage;
            stage.width = width;
            stage.height = height;
            const stageCtx = stage.getContext('2d', { willReadFrequently: true });

            // One reusable buffer & ImageData to avoid reallocation per tile
            let pixels = this._readbackBuffer;
            if (!pixels || pixels.length !== width * height * 4) {
                pixels = this._readbackBuffer = new Uint8ClampedArray(width * height * 4);
            }
            if (!this._imageData || this._imageData.width !== width || this._imageData.height !== height) {
                this._imageData = new ImageData(width, height);
            }
            const imageData = this._imageData;

            // Ensure we have a framebuffer to attach sources to
            if (!this._extractionFB) {
                this._extractionFB = gl.createFramebuffer();
            }
            gl.bindFramebuffer(gl.FRAMEBUFFER, this._extractionFB);

            // Small helpers to attach a layer/texture
            const attachLayer = (texArray, layerIndex) => {
                // WebGL2 texture array
                gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, texArray, 0, layerIndex);
            };
            // Read helper (reuses pixels & imageData, draws into `stage`)
            const readToStage = () => {
                gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
                // Set, don’t construct: avoids allocating a new buffer every time
                imageData.data.set(pixels);
                stageCtx.putImageData(imageData, 0, 0);
            };

            // Iterate rows: each row = {texture i, stencil i}
            for (let i = 0; i < length; i++) {
                // ---- texture ----
                if (isGL2 && renderOutput.texture /* texture array */) {
                    attachLayer(renderOutput.texture, i);
                } else {
                    console.error('No valid texture binding for "texture" at index', i);
                    continue;
                }

                if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
                    console.error('Framebuffer incomplete for texture layer', i);
                    continue;
                }
                readToStage();
                // draw scaled into grid
                const colTex = 0;
                const xTex = pad + colTex * (cellW + pad);
                const yBase = (drawLabels ? 18 : 0);
                const yRow = yBase + pad + i * (cellH + pad);
                ctx.drawImage(stage, 0, 0, width, height, xTex, yRow, cellW, cellH);

                // ---- stencil ----
                if (isGL2 && renderOutput.stencil /* texture array */) {
                    attachLayer(renderOutput.stencil, i);
                } else {
                    console.error('No valid texture binding for "stencil" at index', i);
                    continue;
                }

                if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
                    console.error('Framebuffer incomplete for stencil layer', i);
                    continue;
                }
                readToStage();
                const colSt = 1;
                const xSt = pad + colSt * (cellW + pad);
                ctx.drawImage(stage, 0, 0, width, height, xSt, yRow, cellW, cellH);

                // optional row label
                if (drawLabels) {
                    ctx.fillStyle = '#aaa';
                    ctx.font = '12px system-ui';
                    ctx.textBaseline = 'top';
                    ctx.fillText(`#${i}`, pad, yRow - 14);
                }
            }

            // tidy
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        }

        _openDebugWindowFromUserGesture(width, height, title = 'Debug Output') {
            const debug = this.__debugWindow;
            if (debug && !debug.closed) {
                return this.__debugWindow;
            }

            const features = `width=${width},height=${height}`;
            let w = window.open('', 'osd-debug-grid', features);
            if (!w) {
                // Popup blocked even within gesture (some environments)
                // Create a visible fallback button that opens it on another gesture.
                const fallback = document.createElement('button');
                fallback.textContent = 'Open debug window';
                fallback.style.cssText = 'position:fixed;top: 50;left:50;inset:auto 12px 12px auto;z-index:99999';
                fallback.onclick = () => {
                    const w2 = window.open('', 'osd-debug-grid', features);
                    if (w2) {
                        this._initDebugWindow(w2, title, width, height);
                        fallback.remove();
                    } else {
                        // If it still fails, there’s nothing we can do without the user changing settings
                        alert('Please allow pop-ups for this site and click the button again.');
                    }
                };
                document.body.appendChild(fallback);
                return null;
            }

            this._initDebugWindow(w, title, width, height);
            this.__debugWindow = w;
            return w;
        }

        _initDebugWindow(w, title, width, height) {
            if (w.__debugCtx) {
                return;
            }

            w.document.title = title;
            const style = w.document.createElement('style');
            style.textContent = `
    html,body{margin:0;background:#111;color:#ddd;font:12px/1.4 system-ui}
    .head{position:fixed;inset:0 0 auto 0;background:#222;padding:6px 10px}
    canvas{display:block;margin-top:28px}
  `;
            w.document.head.appendChild(style);

            const head = w.document.createElement('div');
            head.className = 'head';
            head.textContent = title;
            w.document.body.appendChild(head);

            const cnv = w.document.createElement('canvas');
            cnv.width = width;
            cnv.height = height;
            w.document.body.appendChild(cnv);
            w.__debugCtx = cnv.getContext('2d');
        }
    };


    // STATIC PROPERTIES
    /**
     * ID pattern allowed for FlexRenderer. ID's are used in GLSL to distinguish uniquely between individual ShaderLayer's generated code parts
     * @property
     * @type {RegExp}
     * @memberof FlexRenderer
     */
    $.FlexRenderer.idPattern = /^(?!_)(?:(?!__)[0-9a-zA-Z_])*$/;

    $.FlexRenderer.BLEND_MODE = [
        'mask',
        'source-over',
        'source-in',
        'source-out',
        'source-atop',
        'destination-over',
        'destination-in',
        'destination-out',
        'destination-atop',
        'lighten',
        'darken',
        'copy',
        'xor',
        'multiply',
        'screen',
        'overlay',
        'color-dodge',
        'color-burn',
        'hard-light',
        'soft-light',
        'difference',
        'exclusion',
        'hue',
        'saturation',
        'color',
        'luminosity',
    ];

    $.FlexRenderer.jsonReplacer = function (key, value) {
        return key.startsWith("_") || ["eventSource"].includes(key) ? undefined : value;
    };

    /**
     * Generic computational program interface
     * @type {{new(*): $.FlexRenderer.Program, context: *, _requiresLoad: boolean, prototype: Program}}
     */
    $.FlexRenderer.Program = class {
        constructor(context) {
            this.context = context;
            this._requiresLoad = true;
        }

        /**
         *
         * @param shaderMap
         * @param shaderKeys
         */
        build(shaderMap, shaderKeys) {
            throw new Error("$.FlexRenderer.Program::build: Not implemented!");
        }

        /**
         * Retrieve program error message
         * @return {string|undefined} error message of the current state or undefined if OK
         */
        getValidateErrorMessage() {
            return undefined;
        }

        /**
         * Set whether the program requires load.
         * @type {boolean}
         */
        set requiresLoad(value) {
            if (this._requiresLoad !== value) {
                this._requiresLoad = value;

                // Consider this event..
                // if (value) {
                //     this.context.raiseEvent('program-requires-load', {
                //         program: this,
                //         requiresLoad: value
                //     });
                // }
            }
        }

        /**
         * Whether the program requires load.
         * @return {boolean}
         */
        get requiresLoad() {
            return this._requiresLoad;
        }

        /**
         * Create program.
         * @param width
         * @param height
         */
        created(width, height) {}

        /**
         * Load program. Arbitrary arguments.
         * Called ONCE per shader lifetime. Should not be called twice
         * unless requested by requireLoad() -- you should not set values
         * that are lost when webgl program is changed.
         */
        load() {}

        /**
         * Use program. Arbitrary arguments.
         */
        use() {}

        /**
         * Unload program. No arguments.
         */
        unload() {}

        /**
         * Destroy program. No arguments.
         */
        destroy() {}
    };

    /**
     * Blank layer that takes almost no memory and current renderer skips it.
     * @type {OpenSeadragon.BlankTileSource}
     */
    $.BlankTileSource = class extends $.TileSource {
        supports(data, url) {
            return data.type === "_blank" || url.type === "_blank";
        }
        configure(options, dataUrl, postData) {
            return $.extend(options, {
                width: 512,
                height: 512,
                _tileWidth: 512,
                _tileHeight: 512,
                tileSize: 512,
                tileOverlap: 0,
                minLevel: 0,
                maxLevel: 0,
                dimensions: new $.Point(512, 512),
            });
        }
        downloadTileStart(context) {
            return context.finish("_blank", undefined, "undefined");
        }
        getMetadata() {
            return this;
        }
        getTileUrl(level, x, y) {
            return "_blank";
        }
    };

})(OpenSeadragon);
