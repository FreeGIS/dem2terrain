function format(str, params = []) {
    var pattern = /{([\s\S])*?}/gim;
    var index = 0;
    var params_index = 0;
    return str.replace(pattern, (match, tuple, offset) => {
        index = offset + match.length;
        params_index += 1;

        // 异常格式处理，对于列表和对象类型的param，对外抛出异常
        if (typeof params[params_index - 1] == [] || typeof params[params_index - 1] == {}) {
            throw TypeError(params[params_index - 1] + "不能为对象类型！");
        }

        if (match.length > 2) {
            match = match.slice(1, match.length - 1);
            return eval('params[params_index-1].' + match);;
        } else {
            return params[params_index - 1];
        }
    });
}

module.exports=format;