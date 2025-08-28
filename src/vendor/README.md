Bundled and minified files are done externally.
 - install library using npm
 - import the library into js file like so:
   - tiles for mapbox: ``import { VectorTile } from '@mapbox/vector-tile'; self.vectorTile = { VectorTile };``
   - pbf: ``import Pbf from 'pbf';self.Pbf = Pbf;``
   - earcut: ``import earcut from 'earcut';self.earcut = earcut;``
 - run browserify and terser to generate minified files, example for earcut:
    ``npx browserify earcut.js -p [ esmify ] > earcut.bundled.js && npx terser earcut.bundled.js -o [prefix]/src/vendor/earcut.min.js``
