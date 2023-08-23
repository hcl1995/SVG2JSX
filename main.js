const shell = require('shelljs');

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const util = require('util');
const readDirP = util.promisify(fs.readdir);
const readFileP = util.promisify(fs.readFile);
const writeFileP = util.promisify(fs.writeFile);
const unlinkP = util.promisify(fs.unlink);

const chalk = require('chalk');

const express = require('express');
const app = express();
app.use(express.static('build'));

const CONFIG_JSON = `config.json`;

const SVG_HEX_COLOR_PROPS = ['fill', 'stroke', 'stopColor'];
const SVG_DIRECT_SYNTAX = [
    {
        CLASSNAME: {
            SVG: 'class',
            JSX: 'className',
        },
    },
    {
        STOP_COLOR: {
            SVG: 'stop-color',
            JSX: 'stopColor',
        },
    },
    {
        STOP_OPACITY: {
            SVG: 'stop-opacity',
            JSX: 'stopOpacity',
        },
    },
    {
        XLINK_HREF: {
            SVG: 'xlink:href',
            JSX: 'xlinkHref',
        },
    },
    {
        CLIP_PATH: {
            SVG: 'clip-path',
            JSX: 'clipPath',
        },
    },
    {
        ENABLE_BACKGROUND: {
            SVG: 'enable-background',
            JSX: 'enableBackground',
        },
    },
    {
        FONT_FAMILY: {
            SVG: 'font-family',
            JSX: 'fontFamily',
        },
    },
    {
        FONT_SIZE: {
            SVG: 'font-size',
            JSX: 'fontSize',
        },
    },
    {
        FILL_RULE: {
            SVG: 'fill-rule',
            JSX: 'fillRule',
        },
    },
    {
        CLIP_RULE: {
            SVG: 'clip-rule',
            JSX: 'clipRule',
        },
    },
    {
        STROKE_WIDTH: {
            SVG: 'stroke-width',
            JSX: 'strokeWidth',
        },
    },
    {
        STROKE_MITERLIMIT: {
            SVG: 'stroke-miterlimit',
            JSX: 'strokeMiterlimit',
        },
    },
];

const USELESS_TAGS = ['metadata', 'title', 'desc'];

// NOTE: have to match array index
const CONTENT_KEYWORD = ['// NOTE: (SVG2JSX) DO NOT DELETE, ADD VIEWBOX.', '// NOTE: (SVG2JSX) DO NOT DELETE, ADD STYLE.', '// NOTE: (SVG2JSX) DO NOT DELETE, ADD PATH.'];
const CONTENT_CONTAINER = ['', '', ''];

const SVG_TEMPLATE = './src/svg_template.js';
const SVG_PREVIEW_JSON = './public/preview.json';
const SVG_PREVIEW_LIST = [];

let STYLE_DATA = {};
let UNUSE_STYLE_DATA_BY_CLASSNAME = [];

const OBJECT_QUOTE = '`';

// NOTE: GLOBAL
let TARGET_CONTENT;

if (!fs.existsSync(CONFIG_JSON)) {
    _redLog('config.json missing!');
} else {
    fs.readFile(CONFIG_JSON, async (err, data) => {
        if (err) {
            _redLog('read config.json failed!');
        } else if (data) {
            // const rawData = JSON.parse(data);
            // const { source, target } = rawData;
            // if (fs.existsSync(source) && fs.existsSync(target)) SVG2JSX(rawData);
            // else _redLog('invalid source or target path in config.json!');

            const rawData = JSON.parse(data);
            const { source, target, options } = rawData;

            if (options && options.isDirectProcessSVG) {
                const svgFiles = await readDirP(source);
                await directProcessSVG(source, svgFiles);
            } else {
                if (fs.existsSync(source) && fs.existsSync(target)) {
                    SVG2JSX(rawData);
                } else {
                    _redLog('invalid source or target path in config.json!');
                }
            }
        }
    });
}

async function SVG2JSX(config) {
    const { source, target } = config;
    const svgFiles = await readDirP(source);
    TARGET_CONTENT = await readFileP(target, 'utf-8');
    checkTargetContentPrefixIntegration();

    if (fs.existsSync(SVG_TEMPLATE)) await unlinkP(SVG_TEMPLATE);
    await extractSVGData(source, svgFiles, config);
    await writeSVGData(target, config);
    await writeSVGPreviewData();
    shell.exec('npm run build');

    _greenLog('\ncompleted');
    _greenLog('\nclick the link to raise issue & feedback: \nhttps://docs.google.com/spreadsheets/d/1wmtmMUZn7k5pe38GZMg6gyfniWilUrY1V0q-YNWYas0/edit?usp=sharing');

    const port = config.port || process.env.PORT || 3000;
    app.listen(port, () => {
        _greenLog(`\nclick the link to see the preview: http://localhost:${port}`);
    });
}

// NOTE: not a proper way to detect, but sufficient for current situation.
function checkTargetContentPrefixIntegration() {
    const regex = new RegExp('prefix', 'gs');
    const matchData = TARGET_CONTENT.match(regex);
    if (!matchData || matchData.length < 5) {
        _redLog(`"prefix" integration incomplete in target svg file, refer to /template/svg_template.js.`);
        process.exit(1);
    }
}

async function extractSVGData(source, svgFiles, config) {
    for (const svgFile of svgFiles) {
        const svgFilePath = path.join(source, svgFile);
        const svgFileData = await readFileP(svgFilePath, 'utf-8');

        const noExtName = svgFile.substring(0, svgFile.lastIndexOf('.'));
        if (TARGET_CONTENT.indexOf(`case "${noExtName}"`) !== -1 || TARGET_CONTENT.indexOf(`case '${noExtName}'`) !== -1) {
            if (config.options.forceReplace) {
                const removeCaseRegex = new RegExp(`case (\`|\'|\")${noExtName}(\`|\'|\")(.*?[\`|'|"|\)];\\s)`, 'gs');
                TARGET_CONTENT = TARGET_CONTENT.replace(removeCaseRegex, '');
            } else {
                _redLog(`process terminated :: ${svgFile} :: switch case ${noExtName} already exist in target file!`);
                process.exit(1);
            }
        }

        console.log(`processing... ${svgFile}`);
        const viewBox = _getViewBox(noExtName, svgFileData);
        const svgStyle = _getStyle(noExtName, svgFileData, config); // NOTE: style was optional info in svg
        const svgPath = _getPath(noExtName, svgFileData); // NOTE: path is the main content

        let filteredSvgStyle = svgStyle;
        if (svgStyle) filteredSvgStyle = _getFilteredSvgStyle(svgStyle);

        const { styleOutput, pathOutput } = _updateUniqueID(filteredSvgStyle, svgPath, noExtName);

        if (viewBox) CONTENT_CONTAINER[0] += `${viewBox}\n\n`;
        if (svgStyle) CONTENT_CONTAINER[1] += `${styleOutput}\n\n`;
        if (svgPath) CONTENT_CONTAINER[2] += `${pathOutput}\n\n`;

        SVG_PREVIEW_LIST.push(noExtName);
    }
}

async function writeSVGData(target, config) {
    let exitCount = 0;

    let newContent = TARGET_CONTENT;
    CONTENT_KEYWORD.forEach((element, index) => {
        const commendIndex = newContent.indexOf(element);
        if (commendIndex !== -1) {
            const afterCommentIndex = commendIndex + element.length;
            newContent = newContent.substring(0, afterCommentIndex) + '\n' + CONTENT_CONTAINER[index] + newContent.substring(afterCommentIndex);
        } else {
            _yellowLog(`append "${element}" under switch case in relevant function to add data into your target file.`);
            exitCount++;
        }
    });
    if (exitCount === CONTENT_KEYWORD.length) {
        _redLog('process terminated :: all comment keyword is not exist in switch case!');
        process.exit(1);
    }

    // NOTE: preview take data in SVG_TEMPLATE
    await _writeNFormat(SVG_TEMPLATE, newContent, true); // NOTE: it write a demo of the target result file (which included target existing data)

    const { demo } = config.options;
    if (!demo) _writeNFormat(target, newContent);
}

async function writeSVGPreviewData() {
    const data = Object.assign({}, { svgPreviews: SVG_PREVIEW_LIST });
    await writeFileP(SVG_PREVIEW_JSON, JSON.stringify(data));
    // shell.exec(`npx prettier --write ${SVG_PREVIEW_JSON}`);
}

async function _writeNFormat(path, data, isDemo) {
    await writeFileP(path, data);
    if (!isDemo) shell.exec(`npx prettier --write ${path}`);
}

function _getViewBox(svgFile, svgFileData) {
    // EXCLUSION REGEX
    const regex = new RegExp(`(?<=viewBox=["']).*?(?=["'])`);
    const matchData = svgFileData.match(regex);
    if (matchData) {
        const output = matchData[0];
        const template = `case "${svgFile}": return "${output}";`;
        return template;
    }
    return undefined;
}

function _getStyle(svgFile, svgFileData, config) {
    // EXCLUSION REGEX
    const regex = new RegExp(`(?<=<style(.*)>).*?(?=</style>)`, 's');
    const matchData = svgFileData.match(regex);
    if (matchData) {
        let output = matchData[0];

        // NOTE: categorize className & ID into object to be filter
        const styleDataRegex = new RegExp(`\\.(.+?)\\}`, 'gs');
        const styleData = output.match(styleDataRegex);

        // NOTE: filtering...
        const styleObject = {};

        const updateFilterData = (classData, filteredUniqueData) => {
            if (styleObject[classData]) {
                if (filteredUniqueData.length !== 0) {
                    styleObject[classData].push(...filteredUniqueData);
                }
            } else {
                // NOTE: DO NOT DIRECT EQUAL TO FILTERED DATA, PASS BY REFERENCE = GG.
                styleObject[classData] = filteredUniqueData ? [...filteredUniqueData] : [];
            }
        };

        const classRegex = new RegExp(`(?<=\\.)(.*?)(?=\\{)`);
        const uniqueIDRegex = new RegExp(`url(.+?)\\)`, 'g');
        const multiClassRegex = new RegExp(`[^,.\\s]+`, 'g');

        let classNamePrefix = '';
        styleData.forEach((element) => {
            // NOTE: handle append name
            if (!classNamePrefix) {
                const classNamePrefixRegex = new RegExp(`(?<=\\.)(.*?)(?=(\\d)+(\\s)*(\\{))`, 'g');
                classNamePrefix = element.match(classNamePrefixRegex)[0];
            }

            const classData = element.match(classRegex)[0];
            const uniqueIDData = element.match(uniqueIDRegex);

            const filteredUniqueData = [];
            (uniqueIDData || []).forEach((element) => {
                const filteredData = element.slice(5, -1);
                filteredUniqueData.push(filteredData);
            });

            if (classData.indexOf(',') === -1) {
                trimmedClassData = classData.trim();
                updateFilterData(trimmedClassData, filteredUniqueData);
            } else {
                const multiClassData = classData.match(multiClassRegex);
                multiClassData.forEach((element) => {
                    trimmedElement = element.trim();
                    updateFilterData(trimmedElement, filteredUniqueData);
                });
            }
        });
        STYLE_DATA = styleObject;

        const nameString = ' .${name}'; // NOTE: some existing file param name might not be 'name', it might be 'classname'. (manual replace all)
        const appendNameRegex = new RegExp(`\\.${classNamePrefix}`, 'g');
        output = output.replace(appendNameRegex, `${nameString} .${classNamePrefix}`);

        const { tint } = config.options;
        if (tint) output = _updateTintSyntax(output, '${color}', ':#[0-9A-F]+;');

        const template = `case "${svgFile}": \nreturn ${OBJECT_QUOTE}${output}${OBJECT_QUOTE};`;
        return template;
    }
    return undefined;
}

function _getPath(svgFile, svgFileData) {
    // EXCLUSION REGEX
    const regex = new RegExp(`(?<=<svg(.+)>).*?(?=<\/svg>)`, 's');
    const matchData = svgFileData.match(regex);
    if (matchData) {
        let output = matchData[0];

        // NOTE: remove useless tag
        USELESS_TAGS.forEach((element) => {
            const uselessTagRegex = new RegExp(`<${element}>(.*)?<\/${element}>`, 'gs');
            if (uselessTagRegex.test(svgFileData)) output = output.replace(uselessTagRegex, '');
        });

        // NOTE: remove style info
        const styleInfoRegex = new RegExp(`<style(.*)>(.+)<\/style>`, 's');
        if (styleInfoRegex.test(svgFileData)) output = output.replace(styleInfoRegex, '');

        // NOTE: update style syntax
        // style="stop-color:#FFFFFF" --> style={{ stopColor: "#FFFFFF" }}
        const styleRegex = new RegExp(`style=".+?"`, 'g');
        const styleList = output.match(styleRegex);
        if (styleList) {
            const replaceAt = (oldString, newString, index) => {
                return oldString.substring(0, index) + newString + oldString.substring(index + 1);
            };

            const uniqueStyleList = styleList.filter((element, index, self) => self.indexOf(element) === index);
            for (let i = 0, l = uniqueStyleList.length; i < l; i++) {
                const svg = uniqueStyleList[i];

                let jsx = svg;
                // ONCE
                jsx = replaceAt(jsx, '{{ ', jsx.indexOf('"'));

                // NOTE: ':' & ';' should have matching number
                const colonLength = jsx.split(':').length - 1;
                const semiColonLength = jsx.split(';').length - 1;
                jsx = replaceAt(jsx, jsx.indexOf(';') !== -1 && colonLength === semiColonLength ? ' }}' : '" }}', jsx.lastIndexOf('"'));

                // EVERY
                jsx = jsx.split(':').join(': "');
                jsx = jsx.split(';').join('", ');

                output = output.split(svg).join(jsx);
            }
        }

        // NOTE: remove empty tag (empty tag remove last)
        // for optimization sake, i don't want to loop through all tag, since one pattern like this atm. (TO BE OBSERVE)
        const emptyTagRegex = new RegExp(`<defs>(\\s)*</defs>`, 'gs');
        const matchEmptyTagData = output.match(emptyTagRegex);
        if (matchEmptyTagData) output = output.replace(matchEmptyTagData, '');

        // NOTE: update direct syntax
        for (let i = 0, l = SVG_DIRECT_SYNTAX.length; i < l; i++) {
            const key = Object.keys(SVG_DIRECT_SYNTAX[i])[0];
            const rawData = SVG_DIRECT_SYNTAX[i][key];
            const { SVG, JSX } = rawData;
            output = output.split(SVG).join(JSX);
        }

        // NOTE: SAMPLE
        // { st0: [],
        //   st1: [],
        //   st2: [],
        //   st3: [],
        //   st4: [],
        //   st5: [],
        //   st6: [],
        //   st7: [],
        //   st8: [],
        //   st9: [],
        //   st10: [ 'SVGID_2_' ],
        // className="st1" || id="SVGID_19_"

        // NOTE: store unuse class & id into array to be filter later.
        const unuseStyleData = [];
        const styleDataKeys = Object.keys(STYLE_DATA);
        styleDataKeys.forEach((e) => {
            const keyValue = STYLE_DATA[e];
            const keyValueBool = keyValue.every((e) => output.indexOf(`id="${e}"`) === -1 && output.indexOf(`xlinkHref="#${e}"`) === -1); // all id not using
            if (output.indexOf(`className="${e}"`) === -1 && keyValueBool) unuseStyleData.push(e); // class & id not using = push
        });
        UNUSE_STYLE_DATA_BY_CLASSNAME = unuseStyleData;

        const template = `case "${svgFile}": \nreturn (<g {...props}>${output}</g>);`;
        return template;
    }
    return undefined;
}

function _getFilteredSvgStyle(svgStyle) {
    const nameString = ' .${name}';

    let filteredSvgStyle = svgStyle;
    for (let i = 0, l = UNUSE_STYLE_DATA_BY_CLASSNAME.length; i < l; i++) {
        const className = `.${UNUSE_STYLE_DATA_BY_CLASSNAME[i]}`;
        const regex = new RegExp(`(?<=${className}).*?(?=})`, 'gs'); // cheap style, TODO: learn inclusion regex method.
        const matchData = filteredSvgStyle.match(regex);

        if (matchData) {
            const replacement = `${nameString} ${className}${matchData[0]}}`;
            filteredSvgStyle = filteredSvgStyle.replace(replacement, '');
        }
    }
    filteredSvgStyle = filteredSvgStyle.replace(/^\s*[\r\n]/gm, ''); // remove empty lines

    return filteredSvgStyle;
}

/**
 * NOTE: same url will be conflict, hence append class name.
 * tag name might be same as ID (e.g. <mask> id='mask'), update for id & xlinkHref only.
 *
 * some ID shared through out the entire svg export, gg. = =
 */
function _updateUniqueID(styleData, pathData, svgFile) {
    let styleOutput = styleData;

    const prefix = '${prefix}-';
    const styleDataKeys = Object.keys(STYLE_DATA);
    for (let i = 0, l = styleDataKeys.length; i < l; i++) {
        const idList = STYLE_DATA[styleDataKeys[i]];
        if (idList.length > 0) {
            idList.forEach((id) => {
                // update unique style id
                // NOTE: idList only store id of style, some id declared directly in path, hence cannot do here.
                if (styleOutput) styleOutput = styleOutput.replace(`#${id}`, `#${svgFile}-${prefix}${id}`);
            });
        }
    }

    // update unique path id
    let pathOutput = pathData;
    if (pathOutput) {
        const updatePathPrefix = (config) => {
            const { dataList, fromString, toString, frontReplacement, backReplacement } = config;
            if (dataList) {
                dataList.forEach((data) => {
                    const firstIndex = data.indexOf(fromString);
                    const lastIndex = data.lastIndexOf(toString);
                    const svgID = data.substring(firstIndex + 1, lastIndex);
                    pathOutput = pathOutput.replace(data, `${frontReplacement}${svgFile}-${prefix}${svgID}${backReplacement}`);
                });
            }
        };

        // id="SVGID_5_" --> id={`SL-HC-${prefix}-SVGID_5_`}
        const idRegex = new RegExp(`id="(.+?)"`, 'gs');
        const idList = pathOutput.match(idRegex);
        const idConfig = { dataList: idList, fromString: '"', toString: '"', frontReplacement: `id={${OBJECT_QUOTE}`, backReplacement: `${OBJECT_QUOTE}}` };
        updatePathPrefix(idConfig);

        // xlinkHref="#SVGID_5_" --> xlinkHref={`#SL-HC-${prefix}-SVGID_5_`}
        const xlinkHrefRegex = new RegExp(`xlinkHref="#(.+?)"`, 'gs');
        const xlinkHrefList = pathOutput.match(xlinkHrefRegex);
        const xlinkHrefConfig = {
            dataList: xlinkHrefList,
            fromString: '#',
            toString: '"',
            frontReplacement: `xlinkHref={${OBJECT_QUOTE}#`,
            backReplacement: `${OBJECT_QUOTE}}`,
        };
        updatePathPrefix(xlinkHrefConfig);

        // clipPath="url(#clip0_100_2924)" --> clipPath={`url(#beta_comm-${prefix}-clip0_100_2924)`}
        // NOTE: clipPath value confirm is url type
        const clipPathRegex = new RegExp(`clipPath="(.+?)"`, 'gs');
        const clipPathList = pathOutput.match(clipPathRegex);
        const clipPathConfig = {
            dataList: clipPathList,
            fromString: '#',
            toString: ')',
            frontReplacement: `clipPath={${OBJECT_QUOTE}url(#`,
            backReplacement: `)${OBJECT_QUOTE}}`,
        };
        updatePathPrefix(clipPathConfig);

        // fill="url(#paint0_linear_100_2924)" --> fill={`url(#beta_comm-${prefix}-paint0_linear_100_2924)`}
        // NOTE: fill value could be fill:"#ffffff" OR url type, hence regex need specific url related.
        const fillRegex = new RegExp(`fill="url\\(#(.+?)"`, 'gs');
        const fillList = pathOutput.match(fillRegex);
        const fillConfig = {
            dataList: fillList,
            fromString: '#',
            toString: ')',
            frontReplacement: `fill={${OBJECT_QUOTE}url(#`,
            backReplacement: `)${OBJECT_QUOTE}}`,
        };
        updatePathPrefix(fillConfig);

        // "url(#SVGID_5_)" --> `url(#SL-HC-${prefix}-SVGID_2_)`
        const urlRegex = new RegExp(`"url\\(#(.+?)"`, 'gs');
        const urlList = pathOutput.match(urlRegex);
        const urlConfig = {
            dataList: urlList,
            fromString: '#',
            toString: ')',
            frontReplacement: `${OBJECT_QUOTE}url(#`,
            backReplacement: `)${OBJECT_QUOTE}`,
        };
        updatePathPrefix(urlConfig);
    }

    return {
        styleOutput,
        pathOutput,
    };
}

function _updateTintSyntax(data, syntax, regex) {
    let output = data;
    for (let i = 0, l = SVG_HEX_COLOR_PROPS.length; i < l; i++) {
        const regexOutput = new RegExp(`${SVG_HEX_COLOR_PROPS[i]}${regex}`, 'g');
        const replacement = `${SVG_HEX_COLOR_PROPS[i]}:${syntax}`;
        if (regexOutput.test(data)) output = output.replace(regexOutput, replacement);
    }
    return output;
}

function _redLog(string) {
    console.log(chalk.red(string));
}

function _yellowLog(string) {
    console.log(chalk.yellow(string));
}

function _greenLog(string) {
    console.log(chalk.green(string));
}

async function directProcessSVG(source, svgFiles) {
    for (const svgFile of svgFiles) {
        const svgFilePath = path.join(source, svgFile);
        let svgFileData = await readFileP(svgFilePath, 'utf-8');
        const noExtName = svgFile.substring(0, svgFile.lastIndexOf('.'));

        if (noExtName) {
            // let svgCssStyles = _getSVGCssStyles(svgFileData); // get SVG CSS styles
            // const classNameBySVGFile = svgFile && svgFile.split('.')[0]; // banner.svg become banner

            // process classname first
            let classNameBySVGFile = svgFile && svgFile.split('.')[0]; // banner.svg become banner
            classNameBySVGFile = classNameBySVGFile.replace(' ', '_');
            classNameBySVGFile = classNameBySVGFile + crypto.randomBytes(6).toString('hex');
            classNameBySVGFile = _shuffleClassString(classNameBySVGFile); // shuffle classname to try unique

            // NOTE: this can be optional, if true will rename css, if false will not do anytihng
            svgFileData = _preRemoveSvgBaseClass(svgFileData);

            // filter svg open/end tag to check if class exist, if exist then return
            const svgRegex = new RegExp(`(?<=<svg(.+)>).*?(?=<\/svg>)`, 's');
            let matchData = svgFileData.match(svgRegex) && svgFileData.match(svgRegex)[0];
            let svgOpenEndTag = svgFileData.replace(matchData, '');

            // if got class means processed so can skip (assume if designer pass de svg don't have class)
            if (svgOpenEndTag.indexOf('class="') !== -1) {
                return;
            } else {
                try {
                    // process remove unsed styles
                    // process massage unique classname and bind to <style>
                    // if required process will overwrite file, if not won't touch svg any code.
                    let preSvgData = _preRemoveSvgUnusedStyles(svgFileData); // remove unsed style first, because designer de image contain many unused styles
                    preSvgData = preSvgData ? _preMassageSvgForClassname(preSvgData, classNameBySVGFile) : false; // massage again if preset return data

                    // if preSvgData is false dont do anything
                    if (preSvgData) {
                        let tempSvgFilePath = svgFilePath + '.tmp';

                        fs.writeFile(tempSvgFilePath, preSvgData, function writeJSON(err) {
                            if (err) {
                                return console.log(err);
                            }
                            fs.rename(tempSvgFilePath, svgFilePath, function (err) {
                                if (err) {
                                    console.log('ERROR: ' + err);
                                } else {
                                    console.log('writing to ' + svgFilePath);
                                }
                            });
                        });
                    }
                } catch (err) {
                    console.log('Catched Error Exception: ', err);
                    console.log('Error File Location: ', svgFilePath);
                }
            }
        }
    }
}

// only will run if isEditSvg true
function _preRemoveSvgBaseClass(svgFileData) {
    // filter svg open/end tag to check if class exist, if exist then return
    const svgRegex = new RegExp(`(?<=<svg(.+)>).*?(?=<\/svg>)`, 's');
    let matchData = svgFileData.match(svgRegex) && svgFileData.match(svgRegex)[0];

    // get svgNode
    let svgNode = svgFileData.replace(matchData, '');
    svgNode = svgNode.substring(svgNode.indexOf('<svg'), svgNode.length);

    if (svgNode.indexOf('class="') !== -1) {
        let svgNodePropertiesString = svgNode.replace('</svg>', '').replace('<svg', '').replace('>', ''); //remove <svg and >, update become properties
        let svgNodeProperties = svgNodePropertiesString.match(/(".*?"|[^"\s]+)+(?=\s*|\s*$)/g); //split by space and ignore space of double quotes
        let svgOpenNodeTag = svgNode && svgNode.substring(0, svgNode.indexOf('>') + 1);
        let processSvgOpenNodeTag = '';

        let processSvgNodePropertiesString = '';
        let baseClassValue = ''; // used for remove match value from styleData

        // remove baseClass from svgNode, process svg node properties string
        for (let i = 0; i < svgNodeProperties.length; i++) {
            let property = svgNodeProperties[i];
            if (property.includes('class="')) {
                baseClassValue = property.match(/"(.*?)"/) && property.match(/"(.*?)"/)[1]; // get string between double quotes of classname
                svgNodeProperties.splice(i, 1);
            } else {
                processSvgNodePropertiesString += property + ' ';
            }
        }

        // replace svgNode properties to new
        processSvgOpenNodeTag = '<svg ' + processSvgNodePropertiesString + '>';
        svgFileData = svgFileData.replace(svgOpenNodeTag, processSvgOpenNodeTag);

        // remove baseClass from style
        const styleDataRegex = new RegExp(`(?<=<style(.*)>).*?(?=</style>)`, 's');
        let matchStyleData = svgFileData.match(styleDataRegex) && svgFileData.match(styleDataRegex)[0];
        let processStyleData = replaceAll(matchStyleData, '.' + baseClassValue, '');
        svgFileData = svgFileData.replace(styleDataRegex, processStyleData);
    }
    return svgFileData;
}

// remove unsed styles
function _preRemoveSvgUnusedStyles(svgFileData) {
    let styleData = [];
    let filterStyleData = [];
    let filterCssString = '';
    let preSvgFileData = '';
    // remove until remaining path tags
    const svgRegex = new RegExp(`(?<=<svg(.+)>).*?(?=<\/svg>)`, 's');
    // const svgRegex = new RegExp(`<svg(.*)>(.+)<\/svg>`, 's');
    let matchData = svgFileData.match(svgRegex) && svgFileData.match(svgRegex)[0];
    const styleRegex = new RegExp(`<style(.*)>(.+)<\/style>`, 's');
    let cssStylesArr = _getSVGCssStyles(svgFileData);
    styleData = matchData.match(styleRegex) && matchData.match(styleRegex)[0];
    matchData = matchData.replace(styleData, '');

    const dataClassRegex = new RegExp(`class=".*?"`, 'g');

    let matchDataClassName = matchData && matchData.match(dataClassRegex) ? matchData.match(dataClassRegex) : [];
    let filterMatchDataClasses = []; // var for filter duplicated classvalue, used for remove unused styles
    // remove until remaining path tags end

    // here do select distinct class="{{class}}"
    for (let i = 0; i < matchDataClassName.length; i++) {
        let classValue = matchDataClassName[i].match(/"(.*?)"/) && matchDataClassName[i].match(/"(.*?)"/)[1]; // get string between double quotes of classname
        if (!filterMatchDataClasses.includes(classValue)) {
            filterMatchDataClasses.push(classValue);
        }
    }

    // if svg initial style empty ady, direct return dont need do anything.
    if (!cssStylesArr) {
        return false;
    } else {
        for (let i = 0; i < cssStylesArr.length; i++) {
            let cssStyle = cssStylesArr[i];
            let seperated = cssStyle.split('{');
            if (seperated && seperated.length > 0) {
                let styleClassName = seperated[0];
                styleClassName = styleClassName.split('.').join(''); // remove dot from style

                // chk unsed style from distinct classes
                for (let i = 0; i < filterMatchDataClasses.length; i++) {
                    if (filterMatchDataClasses[i].includes(styleClassName)) {
                        filterStyleData.push(cssStyle);
                    }
                }
            }
        }

        for (let i = 0; i < filterStyleData.length; i++) {
            filterCssString += filterStyleData[i] + ' ';
        }

        // replace regex-ed style value
        const styleDataRegex = new RegExp(`(?<=<style(.*)>).*?(?=</style>)`, 's');
        preSvgFileData = svgFileData.replace(styleDataRegex, filterCssString);

        return preSvgFileData;
    }
}

// process svgOpenTag for bind classname
// reprocess style by bind classname to ensure unique style
// if required massage will return massaged data
// if don't need massage will return false

function _preMassageSvgForClassname(svgFileData, classNameBySVGFile) {
    let preSvgTag = svgFileData.substring(svgFileData.indexOf('<svg'), svgFileData.length);
    let removedPreSvgTag = svgFileData.substring(0, svgFileData.indexOf(preSvgTag)); // used for later combine to add back
    let svgOpenTag = preSvgTag && preSvgTag.substring(0, preSvgTag.indexOf('>') + 1); // update become <svg***> without </svg>
    let removedAfterSvgOpenTag = svgOpenTag && svgFileData.substring(svgFileData.indexOf(svgOpenTag) + svgOpenTag.length, svgFileData.length + 1); // used for later combine to add back

    if (svgOpenTag) {
        let svgOpenTagProperties = svgOpenTag.replace('<svg', '').replace('>', ''); // remove <svg and >, update become properties
        let properties = svgOpenTagProperties.match(/(".*?"|[^"\s]+)+(?=\s*|\s*$)/g); //split by space and ignore space of double quotes
        let finalClassOfSVG = '';
        let svgClassValue = null;

        // find if svgTag got classname or not
        let foundSvgDefaultClass = false;

        if (!properties) {
            properties = []; // if svg open tag don't have properties,  set empty
        }

        for (let i = 0; i < properties.length; i++) {
            // if key is class= and contain classname (default)
            if (properties[i].includes('class=')) {
                foundSvgDefaultClass = true;
                svgClassValue = properties[i].match(/"(.*?)"/) && properties[i].match(/"(.*?)"/)[1]; // get string between double quotes of classname
                // make sure existing classname won't duplicate with new added classname
                if (!svgClassValue.includes(classNameBySVGFile)) {
                    finalClassOfSVG = 'class="' + svgClassValue + ' ' + classNameBySVGFile + '"';
                    properties[i] = finalClassOfSVG; // overwrite property to use massage classname
                }
            }
        }

        // if svgTag dont have class, manual add in
        if (!foundSvgDefaultClass) {
            finalClassOfSVG = 'class="' + classNameBySVGFile + '"';
            properties.push(finalClassOfSVG);
        }

        // next, combined properties to make it become svgTag
        let preMassageSvgOpenTag = '';
        let finalMassageSvgTag = '';
        for (let i = 0; i < properties.length; i++) {
            preMassageSvgOpenTag += properties[i] + ' ';
        }

        finalMassageSvgTag = removedPreSvgTag + '<svg ' + preMassageSvgOpenTag + '>' + removedAfterSvgOpenTag;

        // ****************** handling inside <style> ******************'
        let svgCssStyles = _getSVGCssStyles(finalMassageSvgTag); // get SVG CSS styles
        let cssStylesString = '';

        // after pre removed unused styles might be empty
        // if empty dont need do anything
        if (svgCssStyles && svgCssStyles.length > 0) {
            // update original className to be append with SVG file name. (for unique)
            for (let i = 0; i < svgCssStyles.length; i++) {
                let cssStyle = svgCssStyles[i];
                let seperated = cssStyle.split('{');
                if (seperated && seperated.length > 0) {
                    let oriStyleClassName = seperated[0];
                    let styleProperties = '{' + seperated[1];

                    let newClassName = oriStyleClassName;
                    // make sure existing classname won't duplicate with new added classname
                    if (!oriStyleClassName.includes(classNameBySVGFile)) {
                        newClassName = '.' + classNameBySVGFile.concat(' ' + oriStyleClassName);
                    }

                    svgCssStyles[i] = newClassName + styleProperties;
                }
            }

            // massage css styles from array to string
            for (let i = 0; i < svgCssStyles.length; i++) {
                cssStylesString += svgCssStyles[i] + ' ';
            }

            // replace regex-ed style value
            const styleRegex = new RegExp(`(?<=<style(.*)>).*?(?=</style>)`, 's');
            finalMassageSvgTag = finalMassageSvgTag.replace(styleRegex, cssStylesString);
            // ****************** handling inside <style> end ******************

            return finalMassageSvgTag;
        } else {
            return false;
        }
    }
}

function _getSVGCssStyles(svgFileData) {
    let cssStyles = [];
    const regex = new RegExp(`(?<=<style(.*)>).*?(?=</style>)`, 's');
    const matchData = svgFileData.match(regex);

    if (matchData) {
        let output = matchData[0];
        // NOTE: categorize className & ID into object to be filter
        const styleDataRegex = new RegExp(`\\.(.+?)\\}`, 'gs');
        const styleData = output.match(styleDataRegex);
        cssStyles = styleData;
    }
    return cssStyles;
}

function _shuffleClassString(string) {
    var a = string.split(''),
        n = a.length;

    for (var i = n - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var tmp = a[i];
        a[i] = a[j];
        a[j] = tmp;
    }

    let finalString = 'h' + a.join(''); //ensure 1st char not digit
    return finalString;
}

function replaceAll(str, search, replacement) {
    return str.replace(new RegExp(search, 'g'), replacement);
}
