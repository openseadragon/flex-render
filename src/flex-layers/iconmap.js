(function($) {
    /**
     * Class-icon shader
     *
     * Scalar input is classified by the advanced slider control.
     * Each interval is mapped to its own icon texture.
     * The icon is then repeated over the visible class area using a configurable grid.
     */
    class IconMapShader extends $.FlexRenderer.ShaderLayer {
        static type() {
            return "iconmap";
        }

        static name() {
            return "IconMap";
        }

        static description() {
            return "maps scalar classes to repeated per-class icons";
        }

        static docs() {
            return {
                summary: "Scalar-to-icon class shader.",
                description: "Samples one scalar channel, classifies each sparse screen-space marker cell by the value at its center, maps each interval to its own icon texture, and renders the whole icon for that class.",
                kind: "shader",
                inputs: [{
                    index: 0,
                    acceptedChannelCounts: [1],
                    description: "1D scalar data used for class selection"
                }],
                controls: [
                    { name: "use_channel0", default: "r" },
                    {
                        name: "threshold",
                        ui: "advanced_slider",
                        valueType: "float",
                        default: {
                            default: [0.25, 0.75],
                            mask: [1, 1, 1]
                        },
                        required: {
                            type: "advanced_slider",
                            inverted: false
                        }
                    },
                    {
                        name: "iconN",
                        ui: "icon",
                        valueType: "vec4",
                        description: "One icon control is generated per class interval."
                    },
                    { name: "grid_layout", ui: "select_int", valueType: "int", default: { default: 0 } },
                    { name: "cell_size", ui: "float", valueType: "float", default: { default: 15 } },
                    { name: "icon_scale", ui: "float", valueType: "float", default: { default: 0.82 } },
                    { name: "clip_icons", ui: "bool", valueType: "bool", default: { default: false } }
                ]
            };
        }

        static sources() {
            return [{
                acceptsChannelCount: (x) => x === 1,
                description: "1D scalar data used for class selection"
            }];
        }

        static get defaultControls() {
            return {
                use_channel0: {  // eslint-disable-line camelcase
                    default: "r"
                },
                threshold: {
                    default: {
                        type: "advanced_slider",
                        default: [0.25, 0.75],
                        mask: [1, 1, 1],
                        title: "Breaks",
                        pips: {
                            mode: "positions",
                            values: [0, 25, 50, 75, 100],
                            density: 4
                        }
                    },
                    accepts: (type) => type === "float",
                    required: { type: "advanced_slider", inverted: false }
                },
                icons: {
                    array: {
                        count: (layer) => layer._getClassCount(),
                        name: (index) => `icon${index}`,
                        item: (index, layer) => ({
                            default: {
                                type: "icon",
                                title: `Icon ${index + 1}`,
                                default: layer._getDefaultIconName(index),
                                size: 384,
                                padding: 10,
                                previewSize: 40
                            },
                            accepts: (type) => type === "vec4"
                        })
                    }
                },
                grid_layout: {  // eslint-disable-line camelcase
                    default: {
                        type: "select",
                        title: "Grid Layout",
                        default: 0,
                        options: [
                            { value: 0, label: "Square" },
                            { value: 1, label: "Brick" }
                        ]
                    },
                    accepts: (type) => type === "int"
                },
                cell_size: { // eslint-disable-line camelcase
                    default: {
                        type: "range_input",
                        title: "Cell Size (px)",
                        default: 15,
                        min: 3,
                        max: 50,
                        step: 1
                    },
                    accepts: (type) => type === "float"
                },
                icon_scale: { // eslint-disable-line camelcase
                    default: {
                        type: "range_input",
                        title: "Icon Size",
                        default: 0.82,
                        min: 0.3,
                        max: 1.0,
                        step: 0.01
                    },
                    accepts: (type) => type === "float"
                },
                clip_icons: { // eslint-disable-line camelcase
                    default: {
                        type: "bool",
                        title: "Clip To Data",
                        default: false
                    },
                    accepts: (type) => type === "bool"
                }
            };
        }

        init() {
            const initialClassCount = this._getClassCount();

            if (this.threshold) {
                this.threshold.on("breaks", (raw) => {
                    const nextClassCount = Array.isArray(raw) ? raw.length + 1 : initialClassCount;
                    if (nextClassCount !== initialClassCount && typeof this._refresh === "function") {
                        this._refresh();
                        return;
                    }
                    if (typeof this.threshold.syncMaskToIntervals === "function") {
                        this.threshold.syncMaskToIntervals((index) => index, true);
                    }
                    this.invalidate();
                }, true);
            }

            super.init();

            if (this.threshold && typeof this.threshold.syncMaskToIntervals === "function") {
                this.threshold.syncMaskToIntervals((index) => index, true);
                this.invalidate();
            }
        }

        _getClassCount() {
            if (this.threshold && typeof this.threshold.getIntervalCount === "function") {
                return this.threshold.getIntervalCount();
            }
            const fallbackBreaks = this.constructor.defaultControls.threshold.default.default || [];
            return Math.max(1, fallbackBreaks.length + 1);
        }

        _getDefaultIconName(index) {
            const defaultIcons = ["diamond", "circle", "triangle-up", "square", "star", "flag", "plus", "check"];
            return defaultIcons[index % defaultIcons.length];
        }

        _getIconControl(index) {
            const control = this[`icon${index}`];
            return control && typeof control.sample === "function" ? control : null;
        }

        _buildGridHelpers() {
            const uid = this.uid;

            return `
float iconmap_decodeCellSize_${uid}(float rawValue) {
        return rawValue <= 1.0 ? mix(${this.cell_size.params.min}.0, ${this.cell_size.params.max}.0, clamp(rawValue, 0.0, 1.0)) : rawValue;
    }

vec3 iconmap_gridUv_${uid}(vec2 fragCoord) {
        int layoutMode = ${this.grid_layout.sample()};
        float cellSize = max(iconmap_decodeCellSize_${uid}(${this.cell_size.sample()}), 1.0);
        float iconScale = clamp(${this.icon_scale.sample()}, 0.3, 1.0);
        float padding = clamp((1.0 - iconScale) * 0.5, 0.0, 0.49);
        vec2 coord = fragCoord / vec2(cellSize);
        vec2 cell = floor(coord);
        if (layoutMode == 1) {
            float oddRow = mod(cell.y, 2.0);
            coord.x += 0.5 * oddRow;
        }
        vec2 local = fract(coord);

        vec2 spacingVec = vec2(padding);
        vec2 feather = max(fwidth(local), vec2(1e-4));

        vec2 lowMask = smoothstep(spacingVec - feather, spacingVec + feather, local);
        vec2 highMask = 1.0 - smoothstep(vec2(1.0) - spacingVec - feather, vec2(1.0) - spacingVec + feather, local);
        float inside = lowMask.x * lowMask.y * highMask.x * highMask.y;

        vec2 denom = max(vec2(1.0) - 2.0 * spacingVec, vec2(1e-5));
        vec2 paddedUv = clamp((local - spacingVec) / denom, 0.0, 1.0);

        return vec3(paddedUv, inside);
    }

vec2 iconmap_cellCenterUv_${uid}(vec2 dataUv) {
        int layoutMode = ${this.grid_layout.sample()};
        float cellSize = max(iconmap_decodeCellSize_${uid}(${this.cell_size.sample()}), 1.0);
        vec2 coord = gl_FragCoord.xy / vec2(cellSize);
        vec2 cell = floor(coord);
        float xShift = 0.0;
        if (layoutMode == 1) {
            float oddRow = mod(cell.y, 2.0);
            xShift = 0.5 * oddRow;
        }
        vec2 centerCoord = vec2(cell.x + 0.5 - xShift, cell.y + 0.5);
        vec2 centerPx = centerCoord * vec2(cellSize);
        vec2 deltaPx = centerPx - gl_FragCoord.xy;
        return dataUv + dFdx(dataUv) * deltaPx.x + dFdy(dataUv) * deltaPx.y;
    }`;
        }

        _buildIconSamplerFunction() {
            const uid = this.uid;
            const classCount = this._getClassCount();
            const branches = [];
            let fallbackExpr = "vec4(0.0)";

            for (let index = 0; index < classCount; index++) {
                const control = this._getIconControl(index);
                if (!control) {
                    continue;
                }
                const sampleExpr = control.sample("localUv", "vec2");
                fallbackExpr = sampleExpr;
                if (index === 0) {
                    branches.push(`if (classIndex <= 0) { return ${sampleExpr}; }`);
                } else {
                    branches.push(`if (classIndex == ${index}) { return ${sampleExpr}; }`);
                }
            }

            return `
vec4 iconmap_sampleIcon_${uid}(int classIndex, vec2 localUv) {
        ${branches.join("\n        ")}
        return ${fallbackExpr};
    }`;
        }

        getFragmentShaderDefinition() {
            return `
${super.getFragmentShaderDefinition()}
${this._buildGridHelpers()}
${this._buildIconSamplerFunction()}
`;
        }

        getFragmentShaderExecution() {
            const uid = this.uid;

            return `
float chan = ${this.sampleChannel("v_texture_coords")};
vec3 grid = iconmap_gridUv_${uid}(gl_FragCoord.xy);

if (grid.z <= 0.0) {
    return vec4(0.0);
}

vec2 centerUv = iconmap_cellCenterUv_${uid}(v_texture_coords);
float centerChan = ${this.sampleChannel("centerUv")};
float classValue = ${this.threshold.sample("centerChan", "float")};
float visibleCenter = step(0.05, classValue + 0.5);

if (visibleCenter <= 0.0) {
    return vec4(0.0);
}

int classIndex = int(floor(classValue + 0.5));
vec4 icon = iconmap_sampleIcon_${uid}(classIndex, grid.xy);
float visible = ${this.clip_icons.sample()} ? step(0.05, ${this.threshold.sample("chan", "float")} + 0.5) : 1.0;

return vec4(icon.rgb, icon.a * visible * grid.z);
`;
        }
    }

    $.FlexRenderer.ShaderMediator.registerLayer(IconMapShader);
})(OpenSeadragon);
