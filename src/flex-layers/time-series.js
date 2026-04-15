(function($) {
/**
 * Identity shader
 *
 * data reference must contain one index to the data to render using identity
 */
$.FlexRenderer.ShaderMediator.registerLayer(class extends $.FlexRenderer.ShaderLayer {

    construct(options, dataReferences) {
        //todo supply options clone? options changes are propagated and then break things

        const ShaderClass = $.FlexRenderer.ShaderMediator.getClass(options.seriesRenderer);
        if (!ShaderClass) {
            //todo better way of throwing errors to show users
            throw "";
        }
        this._renderer = new ShaderClass(`series_${this.uid}`, {
            layer: this.__visualizationLayer,
            webgl: this.webglContext,
            invalidate: this.invalidate,
            rebuild: this._rebuild,
            refetch: this._refetch
        });
        this.series = options.series;
        if (!this.series) {
            //todo err
            this.series = [];
        }

        //parse and correct timeline data
        let timeline = options.timeline;
        if (typeof timeline !== "object") {
            timeline = {type: timeline};
        }
        if (!timeline.step) {
            timeline.step = 1;
        }
        const seriesLength = this.series.length;
        if (timeline.min % timeline.step !== 0) {
            timeline.min = 0;
        }
        if ((timeline.default - timeline.min) % timeline.step !== 0) {
            timeline.default = timeline.min;
        }
        //min is also used as a valid selection: +1
        const requestedLength = (timeline.max - timeline.min) / timeline.step + 1;
        if (requestedLength !== seriesLength) {
            timeline.max = (seriesLength - 1) * timeline.step + timeline.min;
        }

        this._dataReferences = dataReferences;
        super.construct(options, dataReferences);
        this._renderer.construct(options, dataReferences);
    }

    static type() {
        return "time-series";
    }

    static name() {
        return "Time Series";
    }

    static description() {
        return "internally use different shader to render one of chosen elements";
    }

        static docs() {
        return {
            summary: "Wrapper shader that delegates rendering to another shader over a selectable series.",
            description: "Builds an internal renderer selected by seriesRenderer and switches the active data reference through the timeline control. Timeline changes trigger refetch with the selected series item.",
            kind: "shader",
            inputs: [{
                index: 0,
                acceptedChannelCounts: null,
                description: "render selected data source by underlying shader"
            }],
            customParams: [
                {
                    name: "seriesRenderer",
                    default: "identity",
                    description: "Shader type used internally for rendering the selected series element."
                },
                {
                    name: "series",
                    description: "Array of data indexes addressable through the timeline control."
                }
            ],
            controls: [
                {
                    name: "timeline",
                    ui: "range_input",
                    valueType: "float",
                    required: { type: "range_input" }
                }
            ],
            notes: [
                "Opacity is disabled on this wrapper shader.",
                "The delegated renderer contributes fragment shader definition, execution, GL loading, drawing, and HTML controls."
            ]
        };
    }

    static get customParams() {
        return {
            seriesRenderer: {
                usage: "Specify shader type to use in this series. Attach the shader properties as you would normally do with your desired shader.",
                default: "identity"
            },
            series: {
                //todo allow using the same data in different channels etc.. now the data must be distinct
                usage: "Specify data indexes for the series (as if you've specified dataReferences). The dataReferences is expected to be array with single number, the starting data reference. For now, the data indexes must be unique.",
            }
        };
    }

    static get defaultControls() {
        return {
            timeline: {
                default: {title: "Timeline: "},
                accepts: (type, instance) => type === "float",
                required: {type: "range_input"}
            },
            opacity: false
        };
    }


    static sources() {
        return [{
            acceptsChannelCount: (x) => true,
            description: "render selected data source by underlying shader"
        }];
    }

    getFragmentShaderDefinition() {

        return `
${super.getFragmentShaderDefinition()}
${this._renderer.getFragmentShaderDefinition()}`;
    }

    getFragmentShaderExecution() {
        return this._renderer.getFragmentShaderExecution();
    }

    glLoaded(program, gl) {
        super.glLoaded(program, gl);
        this._renderer.glLoaded(program, gl);
    }

    glDrawing(program, gl) {
        super.glDrawing(program, gl);
        this._renderer.glDrawing(program, gl);
    }

    init() {
        super.init();
        this._renderer.init();

        const _this = this;
        this.timeline.on('default', (raw, encoded, ctx) => {
            const value = (Number.parseInt(encoded, 10) - this.timeline.params.min) / _this.timeline.params.step;
            _this._dataReferences[0] = _this.series[value];
            _this._refetch();
        });
    }

    htmlControls() {
        return `
${super.htmlControls()}
<h4>Rendering as ${this._renderer.constructor.name()}</h4>
${this._renderer.htmlControls()}`;
    }
});
})(OpenSeadragon);
