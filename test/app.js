const path = require('path');
const fs = require('fs');

const demPath = path.join(__dirname, 'test.tif');
const tileDirPath = path.join(__dirname, 'terrain');

const config = {
    "zoom": "5-14",
    "epsg": 3857,
    "size": 256,
    "resampling": 2,
    "encoding": "mapbox",
    "input": demPath,
    "output": tileDirPath,
    "clean": true,
    "baseHeight":0,
}

fs.writeFileSync(path.join(__dirname, 'config.json'), JSON.stringify(config));
