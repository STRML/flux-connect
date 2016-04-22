// @flow
import React from 'react';

type ReactRenderable = React.Element | string | number | boolean;

export default class Provider<Flux> extends Component {

  static childContextTypes = {
    flux: React.PropTypes.instanceOf(Flux).isRequired,
  };

  static defaultProps = {
    children: null
  };

  props: {
    flux: Flux,
    children: ReactRenderable
  };

  getChildContext(): ProviderContext {
    const {flux} = this.props;
    flux.getState = () => fluxToData(flux);
    return {
      flux: flux
    };
  }

  render() {
    return Children.only(this.props.children);
  }
}
