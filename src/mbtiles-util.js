const fs = require('fs');
const MBTiles = require('@mapbox/mbtiles');
// 打开mbtiles
function mb_open(mbpath, mode) {
    return new Promise((res, rej) => {
        new MBTiles(`${mbpath}?mode=${mode}`, function (err, mbtiles) {
            if (err)
                rej(err);
            if (mode === 'rw' || mode === 'rwc') {
                mbtiles.startWriting(function (err) {
                    if (err)
                        rej(err);
                    res(mbtiles);
                });
            }
        });
    })
}
// 停止写入
function mb_stop_writing(mbtiles) {
    return new Promise((res, rej) => {
        mbtiles.stopWriting(function (err) {
            if (err)
                rej(err);
            res('stopWriting');
        });
    });
}
// 插入xyz tile
function mb_put_tile(mbtiles, z, x, y, tile_path, isUnlink = true) {
    return new Promise((res, rej) => {
        fs.readFile(tile_path, (err, data) => {
            if (err)
                rej(err);
            mbtiles.putTile(z, x, y, data, function (err) {
                if (err)
                    rej(err);
                if (isUnlink === true) {
                    fs.unlink(tile_path, err => {
                        if (err)
                            rej(err);
                        res('insert');
                    })
                } else
                    res('insert');
            });
        })

    })
}

module.exports = {
    mb_open, mb_stop_writing, mb_put_tile
}