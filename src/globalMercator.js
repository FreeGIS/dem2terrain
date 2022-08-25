const pi_div_360 = Math.PI / 360.0;
const pi_div_180 = Math.PI / 180.0;
const pi_div_2 = Math.PI / 2.0;
const pi_4 = Math.PI * 4;
const pi_2 = Math.PI * 2;
const pi = Math.PI;
const _180_div_pi = 180 / Math.PI;

class GlobalMercator {
    constructor() {
        this.tileSize = 256;
        this.initialResolution = pi_2 * 6378137 / this.tileSize;
        this.originShift = pi_2 * 6378137 / 2.0;
    }

    LatLonToMeters(lat, lon) {
        // Converts given lat/lon in WGS84 Datum to XY in Spherical Mercator EPSG:900913
        let mx = lon * this.originShift / 180.0;
        let my = Math.log(Math.tan((90 + lat) * pi_div_360)) / pi_div_180;

        my = my * this.originShift / 180.0;
        return { mx: mx, my: my };
    }

    MetersToLatLon(mx, my) {
        // Converts XY point from Spherical Mercator EPSG:900913 to lat/lon in WGS84 Datum
        let lon = mx / this.originShift * 180.0;
        let lat = my / this.originShift * 180.0;
        lat =
            _180_div_pi *
            (2 * Math.atan(Math.exp(lat * pi_div_180)) - pi_div_2);
        return { lat: lat, lon: lon };
    }

    MetersToPixels(mx, my, zoom) {
        // Converts EPSG:900913 to pyramid pixel coordinates in given zoom level
        var res = this.Resolution(zoom);
        var px = (mx + this.originShift) / res;
        var py = (my + this.originShift) / res;


        return { px: px, py: py };
    }

    Resolution(zoom) {
        // Resolution (meters/pixel) for given zoom level (measured at Equator)
        return this.initialResolution / Math.pow(2, zoom);
    }

    // tms的计算方向
    TileBounds(tx, ty, zoom, offset = 0) {
        // Returns bounds of the given tile in EPSG:900913 coordinates
        let minx, miny, maxx, maxy;
        const minxy = this.PixelsToMeters(
            tx * this.tileSize - offset,
            ty * this.tileSize - offset,
            zoom
        );
        minx = minxy.mx;
        miny = minxy.my;

        const maxxy = this.PixelsToMeters(
            (tx + 1) * this.tileSize + offset,
            (ty + 1) * this.tileSize + offset,
            zoom
        );
        maxx = maxxy.mx;
        maxy = maxxy.my;


        return { minx: minx, miny: miny, maxx: maxx, maxy: maxy };
    }

    PixelsToMeters(px, py, zoom) {
        // Converts pixel coordinates in given zoom level of pyramid to EPSG:900913
        var res, mx, my;
        res = this.Resolution(zoom);
        mx = px * res - this.originShift;
        my = py * res - this.originShift;
        //my = this.originShift - py * res;
        //console.log(my, Math.pow(2, zoom) - 1 - my);
        //my = Math.pow(2, zoom) - 1 - my;

        return { mx: mx, my: my };
    }

    PixelsToTile(px, py) {
        // Returns a tile covering region in given pixel coordinates
        var tx, ty;
        tx = Math.floor(Math.ceil(px * 1.0 / this.tileSize) - 1);
        ty = Math.floor(Math.ceil(py * 1.0 / this.tileSize) - 1);
        return { tx: tx, ty: ty };
    }

    PixelsToRaster(px, py, zoom) {
        // Move the origin of pixel coordinates to top-left corner
        var mapSize;
        mapSize = this.tileSize << zoom;
        return { x: px, y: mapSize - py };
    }

    LatLonToTile(lat, lon, zoom) {
        var meters = this.LatLonToMeters(lat, lon);
        var pixels = this.MetersToPixels(meters.mx, meters.my, zoom);
        return this.PixelsToTile(pixels.px, pixels.py);
    }

    MetersToTile(mx, my, zoom) {
        var pixels = this.MetersToPixels(mx, my, zoom);
        return this.PixelsToTile(pixels.px, pixels.py);
    }
    ZoomForPixelSize(pixelSize) {
        for (let i = 0; i < 32; i++) {
            if (pixelSize > this.Resolution(i)) {
                if (i != -1)
                    return i - 1;
                else
                    return 0;
            }
        }
    }
    GoogleTile(tx, ty, zoom) {
        // Converts TMS tile coordinates to Google Tile coordinates
        // coordinate origin is moved from bottom-left to top-left corner of the extent
        return { tx: tx, ty: Math.pow(2, zoom) - 1 - ty };
    }

    QuadKey(tx, ty, zoom) {
        // Converts TMS tile coordinates to Microsoft QuadTree
        let quadKey = "";
        ty = 2 ** zoom - 1 - ty;
        for (let i = zoom; i > 0; i--) {
            let digit = 0;
            let mask = 1 << (i - 1);
            if ((tx & mask) != 0) {
                digit += 1;
            }
            if ((ty & mask) != 0) {
                digit += 2;
            }
            quadKey += digit.toString();
        }
        return quadKey;
    }

    QuadKeyToTile(quadKey) {
        // Transform quadkey to tile coordinates
        let tx = 0;
        let ty = 0;
        let zoom = quadKey.length;
        for (let i = 0; i < zoom; i++) {
            let bit = zoom - i;
            let mask = 1 << (bit - 1);
            if (quadKey[zoom - bit] === "1") {
                tx |= mask;
            }
            if (quadKey[zoom - bit] == "2") {
                ty |= mask;
            }
            if (quadKey[zoom - bit] == "3") {
                tx |= mask;
                ty |= mask;
            }
        }
        ty = 2 ** zoom - 1 - ty;
        return { tx: tx, ty: ty, zoom: zoom };
    }
}

module.exports = GlobalMercator;
/*
const globalMercator = new GlobalMercator();

console.log(globalMercator.TileBounds(224, 117, 8));
*/
