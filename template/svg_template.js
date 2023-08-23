import React from 'react';

const getViewBox = (name) => {
    switch (name) {
        // NOTE: (SVG2JSX) DO NOT DELETE, ADD VIEWBOX.
        default:
            return '0 0 0 0';
    }
};

const getStyle = (name, color, prefix) => {
    switch (name) {
        // NOTE: (SVG2JSX) DO NOT DELETE, ADD STYLE.
        default:
            return;
    }
};

const getPath = (name, props, prefix) => {
    switch (name) {
        // NOTE: (SVG2JSX) DO NOT DELETE, ADD PATH.
        default:
            return <path />;
    }
};

// TODO: make all param into object config {}, to get rid of have to follow params sequence.
// NOTE: prefix param handle for safari issue when two same id injected into html, the previous one will lost the reference.
const SVGName = ({ name = '', className = '', style = {}, fill = '', color = '', viewBox = '', width = '100%', height = '100%', prefix = '' }) => (
    <svg
        className={className}
        style={style}
        width={width}
        height={height}
        viewBox={viewBox || getViewBox(name)}
        xmlns='http://www.w3.org/2000/svg'
        xmlnsXlink='http://www.w3.org/1999/xlink'
    >
        <style dangerouslySetInnerHTML={{ __html: getStyle(name, color, prefix) }}></style>
        {getPath(name, { fill }, prefix)}
    </svg>
);

export default SVGName;
