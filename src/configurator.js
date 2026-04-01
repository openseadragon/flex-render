/**
 * Shader configurator for current FlexRenderer API.
 *
 * - compile* methods build machine-friendly docs JSON
 * - serialize* methods serialize docs as json or text
 * - render* methods render static docs or interactive UI
 * - preview is optional and injected through previewAdapter
 *
 * Requires:
 *   - OpenSeadragon.FlexRenderer
 *   - OpenSeadragon.FlexRenderer.ShaderMediator
 *   - OpenSeadragon.FlexRenderer.UIControls
 */
(function($) {

    function deepClone(value) {
        if (typeof structuredClone === "function") {
            return structuredClone(value);
        }
        return JSON.parse(JSON.stringify(value));
    }

    function escapeHtml(v) {
        return String(v || "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;");
    }

    function resolveNode(nodeOrId) {
        if (typeof nodeOrId === "string") {
            const node = document.getElementById(nodeOrId);
            if (!node) {
                throw new Error(`Node "${nodeOrId}" not found`);
            }
            return node;
        }
        if (!(nodeOrId instanceof Node)) {
            throw new Error("Expected DOM node or element id");
        }
        return nodeOrId;
    }

    function isNode(v) {
        return typeof Node !== "undefined" && v instanceof Node;
    }

    function inferDefaultPreviewAssetBasePath() {
        if (typeof document === "undefined" || !document.currentScript || !document.currentScript.src) {  // eslint-disable-line compat/compat
            return null;
        }
        try {
            return new URL("shaders/", document.currentScript.src).toString().replace(/\/$/, "");  // eslint-disable-line compat/compat
        } catch (_) {
            return null;
        }
    }

    function svgToDataUri(svg) {
        return `data:image/svg+xml;utf8,${encodeURIComponent(String(svg || "").trim())}`;
    }

    function getRenderableDimensions(data) {
        if (!data) {
            return { width: 256, height: 256 };
        }

        const width = Number(
            data.videoWidth ||
            data.naturalWidth ||
            data.width ||
            (data.canvas && data.canvas.width) ||
            256
        );
        const height = Number(
            data.videoHeight ||
            data.naturalHeight ||
            data.height ||
            (data.canvas && data.canvas.height) ||
            256
        );

        return {
            width: Math.max(1, Math.round(width) || 256),
            height: Math.max(1, Math.round(height) || 256)
        };
    }

    class Registry {
        constructor(items = {}) {
            this._map = new Map(Object.entries(items));
        }
        register(key, value) {
            this._map.set(key, value);
            return this;
        }
        get(key) {
            return this._map.get(key) || null;
        }
        has(key) {
            return this._map.has(key);
        }
        entries() {
            return [...this._map.entries()];
        }
    }

    class PreviewSession {
        constructor({
                        uniqueId,
                        width = 256,
                        height = 256,
                        backgroundColor = "#00000000",
                        controlMountResolver
                    }) {
            this.uniqueId = $.FlexRenderer.sanitizeKey(uniqueId);
            this.width = width;
            this.height = height;
            this.controlMountResolver = controlMountResolver;
            this._currentShaderId = null;

            this.renderer = new $.FlexRenderer({
                uniqueId: this.uniqueId,
                webGLPreferredVersion: "2.0",
                debug: false,
                interactive: true,
                redrawCallback: () => {},
                refetchCallback: () => {},
                backgroundColor,
                htmlHandler: (shaderLayer, shaderConfig) => {
                    const mount = this.controlMountResolver();
                    if (!mount || !shaderLayer) {
                        return "";
                    }

                    const section = document.createElement("div");
                    section.className = "card bg-base-200 border border-base-300 shadow-sm";

                    const body = document.createElement("div");
                    body.className = "card-body p-3 gap-2";

                    const title = document.createElement("div");
                    title.className = "text-sm font-semibold";
                    title.textContent = shaderConfig.name || shaderLayer.constructor.name();

                    const controlsId = `${this.uniqueId}_${shaderLayer.id}_controls`;
                    const controls = document.createElement("div");
                    controls.id = controlsId;
                    controls.className = "flex flex-col gap-2";

                    body.appendChild(title);
                    body.appendChild(controls);
                    section.appendChild(body);
                    mount.appendChild(section);

                    return controlsId;
                },
                htmlReset: () => {
                    const mount = this.controlMountResolver();
                    if (mount) {
                        mount.innerHTML = "";
                    }
                },
                canvasOptions: {
                    stencil: true
                }
            });

            this.renderer.setDataBlendingEnabled(true);
            this.renderer.setDimensions(0, 0, width, height, 1, 1);
            this.renderer.canvas.classList.add("rounded-box", "border", "border-base-300", "bg-base-100");
        }

        setSize(width, height) {
            this.width = width;
            this.height = height;
            this.renderer.setDimensions(0, 0, width, height, 1, 1);
        }

        setShader(shaderConfig) {
            const config = deepClone(shaderConfig);
            const shaderId = $.FlexRenderer.sanitizeKey(config.id || "preview_layer");
            this._currentShaderId = shaderId;

            this.renderer.deleteShaders();
            this.renderer.createShaderLayer(shaderId, config, true);
            this.renderer.setShaderLayerOrder([shaderId]);

            // Rebuild second-pass to regenerate controls and shader JS/GL state.
            this.renderer.registerProgram(null, this.renderer.webglContext.secondPassProgramKey);
            this.renderer.useProgram(this.renderer.getProgram(this.renderer.webglContext.secondPassProgramKey), "second-pass");
        }

        getShader() {
            if (!this._currentShaderId) {
                return null;
            }
            return this.renderer.getShaderLayer(this._currentShaderId);
        }

        destroy() {
            this.renderer.destroy();
        }
    }

    var ShaderConfigurator = {
        REF: "ShaderConfigurator",
        _uniqueId: "live_setup",
        _renderData: null,
        _previewAdapter: null,
        _previewSession: null,
        _rootNode: null,
        _docsModel: null,
        _onControlSelectFinish: undefined,

        interactiveRenderers: new Registry(),
        docsRenderers: new Registry(),

        previewAssets: {
            basePath: inferDefaultPreviewAssetBasePath(),
            aliases: {
                "bipolar-heatmap": "bipolar-heatmap.png",
                code: "code.png",
                colormap: "colormap.png",
                edge: "edge.png",
                heatmap: "heatmap.png",
                identity: "identity.png"
            },
            registry: new Registry()
        },

        setup: {
            shader: {
                id: "preview_layer",
                name: "Shader controls and configuration",
                type: undefined,
                visible: 1,
                fixed: false,
                tiledImages: [0],
                params: {},
                cache: {}
            }
        },

        renderStyle: {
            _styles: {},
            advanced(key) {
                return this._styles[key] === true;
            },
            setAdvanced(key) {
                this._styles[key] = true;
            },
            ui(key) {
                return !this.advanced(key);
            },
            setUi(key) {
                delete this._styles[key];
            }
        },

        setUniqueId(id) {
            this._uniqueId = $.FlexRenderer.sanitizeKey(id);
        },

        setData(data) {
            this._renderData = data || null;
        },

        setPreviewAssetBasePath(basePath) {
            this.previewAssets.basePath = basePath ? String(basePath).replace(/\/+$/, "") : null;
            return this;
        },

        registerShaderPreview(shaderType, preview) {
            this.previewAssets.registry.register(shaderType, preview);
            return this;
        },

        registerShaderPreviewAlias(shaderType, fileName) {
            this.previewAssets.aliases[shaderType] = fileName;
            return this;
        },

        setPreviewAdapter(adapter) {
            this._previewAdapter = adapter || null;
            return this;
        },

        registerInteractiveRenderer(type, renderer) {
            this.interactiveRenderers.register(type, renderer);
            return this;
        },

        registerDocsRenderer(kind, renderer) {
            this.docsRenderers.register(kind, renderer);
            return this;
        },

        destroy() {
            if (this._previewSession) {
                this._previewSession.destroy();
                this._previewSession = null;
            }
        },

        buildShadersAndControlsDocs(nodeId) {
            const node = resolveNode(nodeId);
            const model = this.compileDocsModel();
            this.renderDocsPage(node, model);
        },

        compileDocsModel() {
            const shaders = $.FlexRenderer.ShaderMediator.availableShaders().map(Shader => {
                const sources = typeof Shader.sources === "function" ? (Shader.sources() || []) : [];
                const controls = this._compileControlDescriptors(Shader);
                const customParams = Shader.customParams || {};

                return {
                    type: Shader.type(),
                    name: typeof Shader.name === "function" ? Shader.name() : Shader.type(),
                    description: typeof Shader.description === "function" ? Shader.description() : "",
                    preview: this._resolveShaderPreview(Shader),
                    sources: sources.map((src, index) => ({
                        index,
                        description: src.description || "",
                        acceptedChannelCounts: this._probeAcceptedChannelCounts(src)
                    })),
                    controls,
                    customParams: Object.entries(customParams).map(([name, meta]) => ({
                        name,
                        usage: (meta && meta.usage) || ""
                    }))
                };
            });

            const controls = this._compileAvailableControls();

            const model = {
                version: 3,
                generatedAt: new Date().toISOString(),
                shaders,
                controls
            };

            this._docsModel = model;
            return model;
        },

        serializeDocs(mode = "json", model = this._docsModel || this.compileDocsModel()) {
            if (mode === "json") {
                return JSON.stringify(model, null, 2);
            }
            if (mode === "text") {
                return this._serializeDocsText(model);
            }
            throw new Error(`Unsupported docs serialization mode "${mode}"`);
        },

        renderDocsPage(nodeId, model = this._docsModel || this.compileDocsModel()) {
            const node = resolveNode(nodeId);
            node.innerHTML = "";

            const root = document.createElement("div");
            root.className = "flex flex-col gap-6";

            const customRoot = this.docsRenderers.get("root");
            if (customRoot) {
                const rendered = customRoot({ configurator: this, model, mount: root });
                if (rendered === false) {
                    node.appendChild(root);
                    return;
                }
            }

            const shadersSection = document.createElement("section");
            shadersSection.className = "flex flex-col gap-4";
            shadersSection.innerHTML = `<h3 class="text-xl font-semibold">Available shaders</h3>`;

            for (const shader of model.shaders) {
                const customShaderRenderer = this.docsRenderers.get("shader");
                let rendered = null;
                if (customShaderRenderer) {
                    rendered = customShaderRenderer({ configurator: this, shader, model });
                }
                shadersSection.appendChild(isNode(rendered) ? rendered : this._renderDefaultShaderDoc(shader));
            }

            const controlsSection = document.createElement("section");
            controlsSection.className = "flex flex-col gap-4";
            controlsSection.innerHTML = `<h3 class="text-xl font-semibold">Available UI controls</h3>`;

            for (const [glType, controls] of Object.entries(model.controls)) {
                const block = document.createElement("div");
                block.className = "card bg-base-100 border border-base-300 shadow-sm";

                const rows = controls.map(ctrl => `
<tr>
    <td class="font-mono">${escapeHtml(ctrl.name)}</td>
    <td class="font-mono">${escapeHtml(ctrl.glType)}</td>
    <td><pre class="text-xs whitespace-pre-wrap">${escapeHtml(JSON.stringify(ctrl.supports, null, 2))}</pre></td>
</tr>`).join("");

                block.innerHTML = `
<div class="card-body">
    <div class="card-title">GL type: <code>${escapeHtml(glType)}</code></div>
    <div class="overflow-x-auto">
        <table class="table table-sm">
            <thead><tr><th>Name</th><th>GL type</th><th>Supports</th></tr></thead>
            <tbody>${rows}</tbody>
        </table>
    </div>
</div>`;
                controlsSection.appendChild(block);
            }

            root.appendChild(shadersSection);
            root.appendChild(controlsSection);
            node.appendChild(root);
        },

        runShaderSelector(nodeId, onFinish) {
            if (!this.picker || typeof this.picker.init !== "function") {
                throw new Error("ShaderConfigurator.picker.init(...) is not available.");
            }
            this.picker.init(this, nodeId, { onFinish });
        },

        runShaderAndControlSelector(nodeId, onFinish) {
            const _this = this;
            this.runShaderSelector(nodeId, async(shaderId) => {
                const src = _this.picker.granularity("image") ||
                    _this.picker.selectionRules.granularity._config.image.granular;

                if (src) {
                    const data = await _this._loadRenderableData(src);
                    if (data) {
                        _this.setData(data);
                    }
                }
                _this.runControlSelector(nodeId, shaderId, onFinish);
            });
        },

        async _loadRenderableData(source) {
            if (!source) {
                return null;
            }

            if (typeof HTMLCanvasElement !== "undefined" && source instanceof HTMLCanvasElement) {
                return source;
            }
            if (typeof HTMLImageElement !== "undefined" && source instanceof HTMLImageElement) {
                if (source.complete && source.naturalWidth > 0) {
                    return source;
                }
                return await new Promise(resolve => {
                    source.onload = () => resolve(source);
                    source.onerror = () => resolve(null);
                });
            }
            if (typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap) {
                return source;
            }
            if (typeof ImageData !== "undefined" && source instanceof ImageData) {
                return source;
            }
            if (typeof source === "string") {
                return await new Promise(resolve => {
                    const image = document.createElement("img");
                    image.decoding = "async";
                    image.onload = () => resolve(image);
                    image.onerror = () => resolve(null);
                    image.src = source;
                });
            }
            if (source && typeof source === "object" && typeof source.src === "string") {
                return await this._loadRenderableData(source.src);
            }
            return source;
        },


        async runControlSelector(nodeId, shaderId, onFinish = undefined) {
            this._onControlSelectFinish = onFinish;
            this._rootNode = resolveNode(nodeId);

            const Shader = $.FlexRenderer.ShaderMediator.getClass(shaderId);
            if (!Shader) {
                throw new Error(`Invalid shader: ${shaderId}. Not present.`);
            }

            const srcDecl = typeof Shader.sources === "function" ? (Shader.sources() || []) : [];
            this.setup.shader = {
                id: "preview_layer",
                name: `Configuration: ${shaderId}`,
                type: shaderId,
                visible: 1,
                fixed: false,
                tiledImages: srcDecl.map((_, i) => i),
                params: deepClone(this.setup.shader.params || {}),
                cache: {}
            };

            this._renderInteractiveShell(this._rootNode, Shader);
            await this._refreshInteractive();
        },

        getCurrentShaderConfig() {
            return deepClone(this.setup.shader);
        },

        refresh() {
            this.setup.shader.cache = {};
            return this._refreshInteractive();
        },

        refreshUserSwitched(controlId) {
            if (this.renderStyle.advanced(controlId)) {
                this.renderStyle.setUi(controlId);
            } else {
                this.renderStyle.setAdvanced(controlId);
            }
            this.refresh();
        },

        refreshUserSelected(controlId, type) {
            if (!this.setup.shader.params[controlId]) {
                this.setup.shader.params[controlId] = {};
            }
            this.setup.shader.params[controlId].type = type;
            this.refresh();
        },

        refreshUserScripted(node, controlId) {
            try {
                this.parseJSONConfig(node.value, controlId);
                node.classList.remove("textarea-error");
                this.refresh();
            } catch (e) {
                node.classList.add("textarea-error");
            }
        },

        refreshUserUpdated(_node, controlId, keyChain, value) {
            const ensure = (o, key) => {
                if (!o[key]) {
                    o[key] = {};
                }
                return o[key];
            };

            let ref = ensure(this.setup.shader.params, controlId);
            const keys = keyChain.split(".");
            const key = keys.pop();
            keys.forEach(x => {
                ref = ensure(ref, x);
            });
            ref[key] = value;
            this.refresh();
        },

        parseJSONConfig(value, controlId) {
            const config = JSON.parse(value);
            const current = this.setup.shader.params[controlId] || {};
            if (current.type && !config.type) {
                config.type = current.type;
            }
            this.setup.shader.params[controlId] = config;
            return config;
        },

        getAvailableControlsForShader(shader) {
            const uiControls = this._buildControls();
            const controls = { ...(shader.defaultControls || {}) };

            if (controls.opacity === undefined || (typeof controls.opacity === "object" && !controls.opacity.accepts("float"))) {
                controls.opacity = {
                    default: {type: "range", default: 1, min: 0, max: 1, step: 0.1, title: "Opacity"},
                    accepts: (type) => type === "float"
                };
            }

            const result = {};
            for (let control in controls) {
                if (control.startsWith("use_")) {
                    continue;
                }
                if (controls[control] === false) {
                    continue;
                }

                const supported = [];
                if (controls[control].required && controls[control].required.type) {
                    supported.push(controls[control].required.type);
                } else {
                    for (let glType in uiControls) {
                        for (let existing of uiControls[glType]) {
                            if (!controls[control].accepts(glType, existing)) {
                                continue;
                            }
                            supported.push(existing.name);
                        }
                    }
                }
                result[control] = [...new Set(supported)];
            }
            return result;
        },

        _compileControlDescriptors(Shader) {
            const supports = this.getAvailableControlsForShader(Shader);
            const defs = Shader.defaultControls || {};

            return Object.keys(supports).map(name => ({
                name,
                supportedUiTypes: supports[name],
                default: (defs[name] && defs[name].default) || null,
                required: (defs[name] && defs[name].required) || null
            }));
        },

        _compileAvailableControls() {
            const built = this._buildControls();
            const out = {};
            for (const [glType, controls] of Object.entries(built)) {
                out[glType] = controls.map(ctrl => ({
                    name: ctrl.name,
                    glType: ctrl.type,
                    uiType: ctrl.uiControlType,
                    supports: deepClone(ctrl.supports || {})
                }));
            }
            return out;
        },

        _probeAcceptedChannelCounts(src) {
            if (!src || typeof src.acceptsChannelCount !== "function") {
                return null;
            }
            const accepted = [];
            for (let n = 1; n <= 32; n++) {
                try {
                    if (src.acceptsChannelCount(n)) {
                        accepted.push(n);
                    }
                } catch (_) {
                    // no-op
                }
            }
            return accepted;
        },

        _serializeDocsText(model) {
            const out = [];
            out.push(`Shader documentation`);
            out.push(`Version: ${model.version}`);
            out.push(`Generated at: ${model.generatedAt}`);
            out.push("");

            for (const shader of model.shaders) {
                out.push(`Shader: ${shader.name} [${shader.type}]`);
                if (shader.description) {
                    out.push(`Description: ${shader.description}`);
                }

                if (shader.sources.length) {
                    out.push(`Sources:`);
                    for (const src of shader.sources) {
                        out.push(`- Source ${src.index}: ${src.description || "No description"}` +
                            (src.acceptedChannelCounts ? ` | accepted channel counts: ${src.acceptedChannelCounts.join(", ")}` : ""));
                    }
                }

                if (shader.controls.length) {
                    out.push(`Controls:`);
                    for (const control of shader.controls) {
                        out.push(`- ${control.name}: supported ui types = ${control.supportedUiTypes.join(", ")}`);
                    }
                }

                if (shader.customParams.length) {
                    out.push(`Custom parameters:`);
                    for (const param of shader.customParams) {
                        out.push(`- ${param.name}: ${param.usage}`);
                    }
                }

                out.push("");
            }

            return out.join("\n");
        },

        _renderDefaultShaderDoc(shader) {
            const card = document.createElement("div");
            card.className = "card bg-base-100 border border-base-300 shadow-sm";
            const preview = this._normalizePreviewDefinition(shader.preview, shader);

            card.innerHTML = `
<details class="bg-base-100">
  <summary class="flex cursor-pointer list-none flex-wrap items-start justify-between gap-4 p-4">
        <span class="min-w-[180px] flex-1">
            <span class="block text-lg font-semibold">${escapeHtml(shader.name)}</span>
            <span class="badge badge-outline mt-1">${escapeHtml(shader.type)}</span>
            <span class="mt-2 block text-sm opacity-80">${escapeHtml(shader.description || "")}</span>
        </span>
        ${this._renderShaderPreviewMarkup(preview, "rounded-box border border-base-300 max-w-[150px] max-h-[150px] shrink-0")}
  </summary>
  <div class="border-t border-base-300 p-4 text-sm">
     ${shader.sources.length ? `
    <div>
        <div class="mb-2 font-semibold">Sources</div>
        <div class="overflow-x-auto">
            <table class="table table-sm">
                <thead><tr><th>#</th><th>Description</th><th>Accepted channels</th></tr></thead>
                <tbody>
                    ${shader.sources.map(src => `
                    <tr>
                        <td>${src.index}</td>
                        <td>${escapeHtml(src.description || "")}</td>
                        <td>${src.acceptedChannelCounts ? escapeHtml(src.acceptedChannelCounts.join(", ")) : "any"}</td>
                    </tr>`).join("")}
                </tbody>
            </table>
        </div>
    </div>` : ""}

    ${shader.controls.length ? `
    <div class="mt-4">
        <div class="mb-2 font-semibold">Controls</div>
        <div class="overflow-x-auto">
            <table class="table table-sm">
                <thead><tr><th>Name</th><th>Supported UI types</th><th>Default</th></tr></thead>
                <tbody>
                    ${shader.controls.map(ctrl => `
                    <tr>
                        <td><code>${escapeHtml(ctrl.name)}</code></td>
                        <td>${escapeHtml(ctrl.supportedUiTypes.join(", "))}</td>
                        <td><pre class="text-xs whitespace-pre-wrap">${escapeHtml(JSON.stringify(ctrl.default || ctrl.required || {}, null, 2))}</pre></td>
                    </tr>`).join("")}
                </tbody>
            </table>
        </div>
    </div>` : ""}
  </div>
</details>`;
            return card;
        },

        _renderInteractiveShell(node, Shader) {
            const shaderType = Shader.type();
            const preview = this._resolveShaderPreview(Shader);
            node.innerHTML = `
<div class="grid grid-cols-1 xl:grid-cols-[minmax(380px,540px)_1fr] gap-4" id="${this._uniqueId}_interactive_root">
    <div class="card bg-base-100 border border-base-300 shadow-sm">
        <div class="card-body gap-4">
            <div class="flex items-center justify-between gap-4">
                <div>
                    <div class="card-title">Shader configurator</div>
                    <div class="badge badge-primary">${escapeHtml(shaderType)}</div>
                </div>
                ${this._onControlSelectFinish ? `<button class="btn btn-primary btn-sm" id="${this._uniqueId}_done_btn">Done</button>` : ""}
            </div>
            <div class="alert alert-info text-sm">
                Renderer-native controls below are mounted by FlexRenderer itself.
                Meta-editors on the left change shader config and recompile the preview.
            </div>
            <div id="${this._uniqueId}_meta_editors" class="flex flex-col gap-3"></div>
        </div>
    </div>

    <div class="card bg-base-100 border border-base-300 shadow-sm">
        <div class="card-body gap-4">
            <div class="card-title">Renderer controls & preview</div>
            ${preview ? `<div class="flex items-center justify-center rounded-box bg-base-200 p-2">${this._renderShaderPreviewMarkup(preview, "rounded-box border border-base-300 max-h-[180px] w-auto")}</div>` : ""}
            <div id="${this._uniqueId}_native_controls" class="flex flex-col gap-3"></div>
            <div id="${this._uniqueId}_preview_host" class="min-h-[180px] flex items-center justify-center rounded-box bg-base-200 p-2"></div>
        </div>
    </div>
</div>`;

            const doneBtn = document.getElementById(`${this._uniqueId}_done_btn`);
            if (doneBtn && this._onControlSelectFinish) {
                doneBtn.addEventListener("click", () => {
                    this._onControlSelectFinish(this.getCurrentShaderConfig());
                });
            }
        },

        async _refreshInteractive() {
            if (!this._rootNode) {
                return;
            }

            const Shader = $.FlexRenderer.ShaderMediator.getClass(this.setup.shader.type);
            if (!Shader) {
                return;
            }

            await this._ensurePreviewSession();
            const previewSize = getRenderableDimensions(this._renderData);
            this._previewSession.setSize(previewSize.width, previewSize.height);
            this._previewSession.setShader(this.setup.shader);

            const previewHost = document.getElementById(`${this._uniqueId}_preview_host`);
            if (previewHost && this._previewSession.renderer.canvas.parentNode !== previewHost) {
                previewHost.innerHTML = "";
                previewHost.appendChild(this._previewSession.renderer.canvas);
            }

            this._renderMetaEditors(Shader);

            if (this._previewAdapter && typeof this._previewAdapter.render === "function") {
                await this._previewAdapter.render({
                    configurator: this,
                    session: this._previewSession,
                    shaderConfig: this.getCurrentShaderConfig(),
                    data: this._renderData
                });
            }
        },

        async _ensurePreviewSession() {
            if (this._previewSession) {
                return;
            }

            const previewSize = getRenderableDimensions(this._renderData);
            this._previewSession = new PreviewSession({
                uniqueId: `${this._uniqueId}_preview`,
                width: previewSize.width,
                height: previewSize.height,
                controlMountResolver: () => document.getElementById(`${this._uniqueId}_native_controls`)
            });
        },

        _resolvePreviewSrc(fileOrSrc) {
            if (!fileOrSrc) {
                return null;
            }
            const value = String(fileOrSrc);
            if (/^(?:data:|blob:|https?:|\/)/i.test(value)) {
                return value;
            }
            const basePath = this.previewAssets.basePath;
            if (!basePath) {
                return value;
            }
            return `${basePath.replace(/\/+$/, "")}/${value.replace(/^\/+/, "")}`;
        },

        _normalizePreviewDefinition(preview, shaderMeta = {}) {
            if (!preview) {
                return null;
            }

            if (typeof preview === "function") {
                preview = preview(shaderMeta);
            }
            if (!preview) {
                return null;
            }

            const alt = preview.alt || `${shaderMeta.name || shaderMeta.type || "Shader"} preview`;

            if (typeof preview === "string") {
                return {
                    src: this._resolvePreviewSrc(preview),
                    alt
                };
            }
            if (preview.svg) {
                return {
                    src: svgToDataUri(preview.svg),
                    alt,
                    className: preview.className || ""
                };
            }
            if (preview.file) {
                return {
                    src: this._resolvePreviewSrc(preview.file),
                    alt,
                    className: preview.className || ""
                };
            }
            if (preview.src) {
                return {
                    src: this._resolvePreviewSrc(preview.src),
                    alt,
                    className: preview.className || ""
                };
            }
            return null;
        },

        _buildFallbackPreview(shaderMeta = {}) {
            const label = escapeHtml(shaderMeta.name || shaderMeta.type || "Shader");
            return this._normalizePreviewDefinition({
                svg: `
+<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180" role="img" aria-label="${label}">
+  <defs>
+    <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
<stop offset="0%" stop-color="#1f2937"/>
<stop offset="100%" stop-color="#111827"/>
+    </linearGradient>
+  </defs>
+  <rect width="320" height="180" rx="18" fill="url(#g)"/>
+  <g fill="none" stroke="#60a5fa" stroke-width="10" opacity="0.9">
+    <path d="M24 126 C72 48, 122 48, 168 126 S264 204, 296 58"/>
+    <path d="M24 86 C72 150, 122 150, 168 86 S264 22, 296 122" opacity="0.55"/>
+  </g>
+  <rect x="20" y="20" width="112" height="30" rx="15" fill="#0f172a" stroke="#334155"/>
+  <text x="76" y="40" text-anchor="middle" font-family="system-ui, sans-serif" font-size="14" fill="#e5e7eb">${label}</text>
+</svg>`,
                alt: `${label} preview`
            }, shaderMeta);
        },

        _resolveShaderPreview(shaderLike) {
            if (!shaderLike) {
                return null;
            }

            const type = typeof shaderLike.type === "function" ? shaderLike.type() : shaderLike.type;
            const name = typeof shaderLike.name === "function" ? shaderLike.name() : shaderLike.name || type;
            const meta = { type, name };

            let preview = this.previewAssets.registry.get(type);
            if (!preview && typeof shaderLike.preview === "function") {
                preview = shaderLike.preview();
            } else if (!preview && shaderLike.preview) {
                preview = shaderLike.preview;
            }
            if (!preview && this.previewAssets.aliases[type]) {
                preview = { file: this.previewAssets.aliases[type] };
            }

            return this._normalizePreviewDefinition(preview, meta) || this._buildFallbackPreview(meta);
        },

        _renderShaderPreviewMarkup(preview, className = "") {
            const normalized = this._normalizePreviewDefinition(preview, {});
            if (!normalized || !normalized.src) {
                return "";
            }
            const classes = [normalized.className || "", className].filter(Boolean).join(" ").trim();
            return `<img alt="${escapeHtml(normalized.alt || "Shader preview")}" loading="lazy" decoding="async" class="${escapeHtml(classes)}" src="${escapeHtml(normalized.src)}">`;
        },

        _renderMetaEditors(Shader) {
            const mount = document.getElementById(`${this._uniqueId}_meta_editors`);
            if (!mount) {
                return;
            }
            mount.innerHTML = "";

            const supports = this.getAvailableControlsForShader(Shader);
            const defs = Shader.defaultControls || {};

            for (const [controlName, supported] of Object.entries(supports)) {
                const current = this.setup.shader.params[controlName] || {};
                const requiredType = defs[controlName] && defs[controlName].required && typeof defs[controlName].required === "object" ?
                    defs[controlName].required.type : undefined;
                const defaultType = defs[controlName] && defs[controlName].default && typeof defs[controlName].default === "object" ?
                    defs[controlName].default.type : undefined;
                const activeType =
                    current.type ||
                    requiredType ||
                    defaultType ||
                    supported[0];

                if (!this.setup.shader.params[controlName]) {
                    this.setup.shader.params[controlName] = { type: activeType };
                } else if (!this.setup.shader.params[controlName].type) {
                    this.setup.shader.params[controlName].type = activeType;
                }

                const card = document.createElement("div");
                card.className = "card bg-base-200 border border-base-300 shadow-sm";

                const useSimple = this.renderStyle.ui(controlName) && !!this.interactiveRenderers.get(activeType);

                card.innerHTML = `
<div class="card-body p-4 gap-3">
    <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
            <div class="font-semibold">Control <code>${escapeHtml(controlName)}</code></div>
            <div class="text-xs opacity-70">Supported: ${escapeHtml(supported.join(", "))}</div>
        </div>
        <div class="flex items-center gap-3">
            <label class="label cursor-pointer gap-2">
                <span class="label-text text-sm">Simple</span>
                <input type="checkbox" class="toggle toggle-sm" ${useSimple ? "checked" : ""} data-role="style-toggle">
            </label>
            <select class="select select-bordered select-sm" data-role="type-select">
                ${supported.map(type => `<option value="${escapeHtml(type)}" ${type === activeType ? "selected" : ""}>${escapeHtml(type)}</option>`).join("")}
            </select>
        </div>
    </div>
    <div data-role="simple-editor"></div>
    <details class="collapse collapse-arrow bg-base-100 border border-base-300">
        <summary class="collapse-title text-sm font-medium">JSON</summary>
        <div class="collapse-content">
            <textarea class="textarea textarea-bordered w-full h-40 font-mono text-xs" data-role="json-editor"></textarea>
        </div>
    </details>
</div>`;

                const typeSelect = card.querySelector(`[data-role="type-select"]`);
                const styleToggle = card.querySelector(`[data-role="style-toggle"]`);
                const simpleEditor = card.querySelector(`[data-role="simple-editor"]`);
                const jsonEditor = card.querySelector(`[data-role="json-editor"]`);

                jsonEditor.value = JSON.stringify(this.setup.shader.params[controlName], null, 2);

                typeSelect.addEventListener("change", () => {
                    this.refreshUserSelected(controlName, typeSelect.value);
                });

                styleToggle.addEventListener("change", () => {
                    this.refreshUserSwitched(controlName);
                });

                jsonEditor.addEventListener("change", () => {
                    this.refreshUserScripted(jsonEditor, controlName);
                });

                const renderer = this.interactiveRenderers.get(activeType);
                if (useSimple && renderer) {
                    const api = {
                        configurator: this,
                        controlName,
                        shaderConfig: this.setup.shader,
                        controlDefinition: defs[controlName],
                        controlConfig: this.setup.shader.params[controlName],
                        mount: simpleEditor,
                        update: (patch) => {
                            this.setup.shader.params[controlName] = {
                                ...this.setup.shader.params[controlName],
                                ...patch
                            };
                            this.refresh();
                        }
                    };

                    const rendered = typeof renderer === "function" ? renderer(api) : renderer.render(api);
                    if (typeof rendered === "string") {
                        simpleEditor.innerHTML = rendered;
                    } else if (isNode(rendered)) {
                        simpleEditor.appendChild(rendered);
                    }
                } else {
                    simpleEditor.innerHTML = `
<div class="alert alert-warning text-sm">
    No simple editor registered for <code>${escapeHtml(activeType)}</code>.
    Use JSON editor.
</div>`;
                }

                mount.appendChild(card);
            }
        },

        _buildControls() {
            if (this.__uicontrols) {
                return this.__uicontrols;
            }
            this.__uicontrols = {};

            const types = $.FlexRenderer.UIControls.types();
            const ShaderClass = $.FlexRenderer.ShaderMediator.getClass("identity");

            const fallbackLayer = new ShaderClass("id", {
                shaderConfig: {
                    id: "fallback__",
                    name: "Layer",
                    type: "identity",
                    visible: 1,
                    fixed: false,
                    tiledImages: [0],
                    params: {},
                    cache: {}
                },
                webglContext: {
                    supportedUseModes: ["show"],
                    includeGlobalCode: () => {}
                },
                params: {},
                interactive: false,
                invalidate: () => {},
                rebuild: () => {},
                refetch: () => {}
            });

            fallbackLayer.construct({}, [0]);

            for (let type of types) {
                const ctrl = $.FlexRenderer.UIControls.build(fallbackLayer, type, {
                    default: { type: type },
                    accepts: () => true
                }, Date.now(), {});

                const glType = ctrl.type;
                ctrl.name = type;
                if (!this.__uicontrols[glType]) {
                    this.__uicontrols[glType] = [];
                }
                this.__uicontrols[glType].push(ctrl);
            }

            return this.__uicontrols;
        }
    };

    // ---------------------------------------------------------------------
    // Optional default simple editors
    // ---------------------------------------------------------------------

    ShaderConfigurator.registerInteractiveRenderer("range", ({ mount, controlConfig, update }) => {
        const spec = controlConfig;
        const wrap = document.createElement("div");
        wrap.className = "flex flex-col gap-2";
        wrap.innerHTML = `
<label class="form-control">
    <div class="label"><span class="label-text">Default</span></div>
    <input class="input input-bordered input-sm" type="number" value="${escapeHtml(spec.default || "")}">
</label>`;
        wrap.querySelector("input").addEventListener("change", (e) => {
            update({ default: Number(e.target.value) });
        });
        mount.appendChild(wrap);
    });

    ShaderConfigurator.registerInteractiveRenderer("range_input", ({ mount, controlConfig, update }) => {
        const spec = controlConfig;
        const wrap = document.createElement("div");
        wrap.className = "grid grid-cols-2 gap-2";
        wrap.innerHTML = `
<label class="form-control">
    <div class="label"><span class="label-text">Default</span></div>
    <input class="input input-bordered input-sm" data-k="default" type="number" value="${escapeHtml(spec.default || "")}">
</label>
<label class="form-control">
    <div class="label"><span class="label-text">Step</span></div>
    <input class="input input-bordered input-sm" data-k="step" type="number" value="${escapeHtml(spec.step || "")}">
</label>
<label class="form-control">
    <div class="label"><span class="label-text">Min</span></div>
    <input class="input input-bordered input-sm" data-k="min" type="number" value="${escapeHtml(spec.min || "")}">
</label>
<label class="form-control">
    <div class="label"><span class="label-text">Max</span></div>
    <input class="input input-bordered input-sm" data-k="max" type="number" value="${escapeHtml(spec.max || "")}">
</label>`;
        wrap.querySelectorAll("input").forEach(input => {
            input.addEventListener("change", () => {
                update({ [input.dataset.k]: Number(input.value) });
            });
        });
        mount.appendChild(wrap);
    });

    ShaderConfigurator.registerInteractiveRenderer("bool", ({ mount, controlConfig, update }) => {
        const wrap = document.createElement("label");
        wrap.className = "label cursor-pointer justify-start gap-3";
        wrap.innerHTML = `
<input type="checkbox" class="toggle toggle-sm" ${controlConfig.default ? "checked" : ""}>
<span class="label-text">Default enabled</span>`;
        wrap.querySelector("input").addEventListener("change", (e) => {
            update({ default: !!e.target.checked });
        });
        mount.appendChild(wrap);
    });

    ShaderConfigurator.registerInteractiveRenderer("color", ({ mount, controlConfig, update }) => {
        const wrap = document.createElement("label");
        wrap.className = "form-control";
        wrap.innerHTML = `
<div class="label"><span class="label-text">Default color</span></div>
<input type="color" class="input input-bordered input-sm p-1" value="${escapeHtml(controlConfig.default || "#ffffff")}">`;
        wrap.querySelector("input").addEventListener("change", (e) => {
            update({ default: e.target.value });
        });
        mount.appendChild(wrap);
    });

    ShaderConfigurator.registerInteractiveRenderer("select_int", ({ mount, controlConfig, update }) => {
        const options = Array.isArray(controlConfig.options) ? controlConfig.options : [];
        const wrap = document.createElement("div");
        wrap.className = "flex flex-col gap-2";
        wrap.innerHTML = `
<label class="form-control">
    <div class="label"><span class="label-text">Default</span></div>
    <input class="input input-bordered input-sm" type="number" value="${escapeHtml(controlConfig.default || 0)}">
</label>
<details class="collapse collapse-arrow bg-base-100 border border-base-300">
    <summary class="collapse-title text-sm font-medium">Options</summary>
    <div class="collapse-content">
        <textarea class="textarea textarea-bordered w-full h-28 font-mono text-xs">${escapeHtml(JSON.stringify(options, null, 2))}</textarea>
    </div>
</details>`;
        const defaultInput = wrap.querySelector("input");
        const optionsArea = wrap.querySelector("textarea");

        defaultInput.addEventListener("change", () => {
            update({ default: Number(defaultInput.value) });
        });
        optionsArea.addEventListener("change", () => {
            update({ options: JSON.parse(optionsArea.value) });
        });
        mount.appendChild(wrap);
    });

    OpenSeadragon.FlexRenderer.ShaderConfigurator = ShaderConfigurator;

})(OpenSeadragon);
