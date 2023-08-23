import React from 'react';
import SVGName from './svg_template';

class SVGPreview extends React.Component {
    constructor() {
        super();
        this.state = {};
    }

    componentDidMount() {
        fetch('preview.json', {
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
            },
        })
            .then((response) => {
                return response.json();
            })
            .then((myJson) => {
                this.setState({ previewList: myJson.svgPreviews });
            });
    }

    render() {
        const { previewList } = this.state;
        return <div>{previewList && previewList.map((e) => <SVGName key={e} name={e} className={e} width='100px' height='100px'></SVGName>)}</div>;
    }
}

export default SVGPreview;
