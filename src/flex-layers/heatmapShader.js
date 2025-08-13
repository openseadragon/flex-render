(function($) {
    /**
     * Identity shader
     */
    $.FlexRenderer.HeatmapLayer = class extends $.FlexRenderer.ShaderLayer {

        static type() {
            return "heatmap";
        }

        static name() {
            return "Heatmap";
        }

        static description() {
            return "encode data values in opacity";
        }

        static sources() {
            return [{
                acceptsChannelCount: (x) => x === 1,
                description: "The value to map to opacity"
            }];
        }

        static get defaultControls() {
            return {
                use_channel0: {  // eslint-disable-line camelcase
                    default: "r"
                },
                color: {
                    default: {type: "color", default: "#fff700", title: "Color: "},
                    accepts: (type, instance) => type === "vec3",
                },
                threshold: {
                    default: {type: "range_input", default: 1, min: 1, max: 100, step: 1, title: "Threshold: "},
                    accepts: (type, instance) => type === "float"
                },
                inverse: {
                    default: {type: "bool", default: false, title: "Invert: "},
                    accepts: (type, instance) => type === "bool"
                }
            };
        }

        getFragmentShaderExecution() {
            return `
    float chan = ${this.sampleChannel('v_texture_coords')};
    bool shows = chan >= ${this.threshold.sample('chan', 'float')};
    if (${this.inverse.sample()}) {
        if (!shows) {
            shows = true;
            chan = 1.0;
        } else chan = 1.0 - chan;
    }
    if (shows) return vec4(${this.color.sample('chan', 'float')}, chan);
    return vec4(.0);
`;
        }
    };

    $.FlexRenderer.ShaderMediator.registerLayer($.FlexRenderer.HeatmapLayer);

})(OpenSeadragon);
