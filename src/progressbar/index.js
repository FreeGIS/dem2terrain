/**
 * 进度条实现。
 */
const log = require('single-line-log').stdout;
const format = require('./format');
const cliColor = require('cli-color');
/**
 * 进度条实现。
 */
const { blue, green, yellow, red } = cliColor;
/**
 * 进度条
 */
class ProgressBar {
    constructor(
        barLength = 28,
        description = 'PROGRESS'
    ) {
        this.length = barLength;
        this.taskTotal = 0;
        this.descriptionStyle = blue.bold(description);

        //this.completed = 0;
        //this.tickStep = tickStep;
    }

    /**
     * 设置一共有多少个任务
     * @param {number} value 
     */
    setTaskTotal(value) {
        this.taskTotal = value
    }

    /**
     * 在控制台中绘制当前进度条
     * @param {number} completed 完成了多少个任务
     */
    render(completed) {
        //this.completed++;
        //const completed = this.completed * this.tickStep;
        const finishedRate = Number((completed / this.taskTotal).toFixed(4));
        const finishedCellCount = Math.floor(finishedRate * this.length);
        let i = 0
        // 拼接黑色条
        let cell = '';
        for (i = 0; i < finishedCellCount; ++i) {
            cell += '█';
        }
        // 拼接灰色条
        let empty = '';
        for (i = 0; i < this.length - finishedCellCount; ++i) {
            empty += '░';
        }

        const percentStr = (100 * finishedRate).toFixed(2);

        /**
         * 使用cli-color进行包装美化。
         */
        const cellStyle = green.bgBlack.bold(cell);
        const completedStyle = green.bold(completed);
        const statusStyle = Number(finishedRate) === 1 ? green.bold('完成') : yellow.bold('转换中⏳')

        // 拼接最终文本
        const cmdtext = format(
            ">> 步骤4: {} - {}% {}{} {}/{}",
            [
                statusStyle,
                percentStr,
                cellStyle,
                empty,
                completedStyle,
                String(this.taskTotal),
            ]
        );

        log(cmdtext);
    }
}
module.exports = ProgressBar;