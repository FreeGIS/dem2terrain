/**
 * 进度条实现。
 */
const log = require('single-line-log').stdout;
const format = require('./format');
const clicolor = require('cli-color');
/**
 * 封装一个进度条工具。
 */
class ProgressBar {
    constructor(taskTotal, bar_length = 28, description = 'PROGRESS') {
        this.length = bar_length;
        this.taskTotal = taskTotal;
        this.totalStyle = clicolor.blue.bold(taskTotal);
        this.descriptionStyle = clicolor.blue.bold(description);
        //this.completed = 0;
        //this.tickStep = tickStep;
    }
    render(completed) {
        //this.completed++;
        //const completed = this.completed * this.tickStep;
        const percentage = (completed / this.taskTotal).toFixed(4);
        const cell_num = Math.floor(percentage * this.length);
        // 拼接黑色条
        let cell = '';
        for (let i = 0; i < cell_num; i++) {
            cell += '█';
        }
        // 拼接灰色条
        let empty = '';
        for (let i = 0; i < this.length - cell_num; i++) {
            empty += '░';
        }

        const percent = (100 * percentage).toFixed(2);
        /**
         * 使用cli-color进行包装美化。
         */

        const cellStyle = clicolor.green.bgBlack.bold(cell);
        const completedStyle = clicolor.yellow.bold(completed);
        const statusStyle = percent == 100.00 ? clicolor.green.bold('任务结束') : clicolor.red.bold('任务执行中');

        // 拼接最终文本
        const cmdtext = format("<{}:{}%> {}{}  [ {}/{}  {}]", [this.descriptionStyle, percent,
            cellStyle, empty, completedStyle, this.totalStyle, statusStyle]);
        log(cmdtext);
    }
}


module.exports = ProgressBar;