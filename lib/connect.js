// @flow
import React from 'react';
import invariant from 'invariant';
import warning from 'warning';
// Makes statics on wrapped component accessible without fuss
import hoistStatics from 'hoist-non-react-statics';
import {isPlainObject} from 'lodash';
import {shallowEqual} from 'shallowEqual';

// ALMOST there! $Shape<Props> successfully makes sure we are only including types that the component
// accepts, but it unfortunately is *not* keeping track of what is and what isn't defined so we can
// error. This means we still won't get *missing* prop errors yet, but we are validating provided props.
export type StateMapper<AppState, Props, U: $Shape<Props>> = (state: AppState, props: ?Props) => U;
export type ConnectOptions = {pure?: boolean, withRef?: boolean};

const {NODE_ENV} = process.env;
const getDisplayName = (Component) => Component.displayName || Component.name || 'Component';

const errorObject = {value: null};
function tryCatch(fn, ctx) {
  try {
    return fn.apply(ctx);
  } catch (e) {
    errorObject.value = e;
    return errorObject;
  }
}

// Hot reloading tracking
let nextVersion = 0;

// This insane type signature actually works.
// A breakdown:
//
// The input type, T, which is actually passed into the returned thunk, is destructured using
// _ReactClass<DefaultProps, Props, *, *>, so we have access to the DefaultProps and Props that Flow
// thinks that class has. We then use that to constraint the types that `mapStateToProps` can return.
//
// What I'd really like to see is a way for Flow to actually diff the props required on the component,
// so that if a component has two props, and one is provided by connect(), Flow knows to require one but
// not the other. Unfortunately we're not quite there yet. PRs welcome.
export default function connect<AppState, Flux, StateProps, DefaultProps, Props, T: _ReactClass<DefaultProps, Props, *, *>>(
    mapStateToProps: StateMapper<AppState, Props, StateProps>, options: ConnectOptions = {})
    : (WrappedComponent: T) => Class<React.Component<DefaultProps, $Diff<Props, StateProps>, *>> {
  const shouldSubscribe = Boolean(mapStateToProps);
  const {pure = true, withRef = false} = options;

  // Helps track hot reloading.
  const version = nextVersion++;

  return function wrapWithConnect(WrappedComponent) {
    const connectDisplayName = `Connect(${getDisplayName(WrappedComponent)})`;

    function checkStateShape(props, methodName) {
      if (!isPlainObject(props)) {
        warning(
          `${methodName}() in ${connectDisplayName} must return a plain object. ` +
          `Instead received ${props}.`
        );
      }
    }

    // TODO can we reduce memory usage/instantiation cost by making this inherit from a base Connect class,
    // and extend only with properties that need to be grabbed from the closure?
    class Connect extends React.Component {

      static displayName = connectDisplayName;
      static WrappedComponent = WrappedComponent;
      static contextTypes = {
        flux: React.PropTypes.instanceOf(Flux)
      };

      props: Props;
      state: {storeState: AppState};

      // Members
      doStatePropsDependOnOwnProps: boolean;
      finalMapStateToProps: ?typeof mapStateToProps;
      haveOwnPropsChanged: boolean;
      hasStoreStateChanged: boolean;
      haveStatePropsBeenPrecalculated: boolean;
      renderedElement: ?React.Element;
      stateProps: ?StateProps;
      statePropsPrecalculationError: ?Error;
      store: Flux;
      unsubscribe: ?Function;
      version: number;

      constructor(props, context: {flux: Flux}) {
        super(props, context);
        this.version = version;
        this.store = props.flux || context.flux;

        invariant(this.store,
          `Could not find "store" in either the context or ` +
          `props of "${connectDisplayName}". ` +
          `Either wrap the root component in a <Provider>, ` +
          `or explicitly pass "store" as a prop to "${connectDisplayName}".`
        );

        const storeState = this.store.getState();
        this.state = {storeState};
        this.clearCache();
      }

      componentDidMount() {
        // Okay, here's where we watch change events on stores.
        this.trySubscribe();
      }

      componentWillReceiveProps(nextProps) {
        if (!pure || !shallowEqual(nextProps, this.props)) {
          this.haveOwnPropsChanged = true;
        }
      }

      componentWillUnmount() {
        this.tryUnsubscribe();
        this.clearCache();
      }

      shouldComponentUpdate() {
        return !pure || this.haveOwnPropsChanged || this.hasStoreStateChanged;
      }

      clearCache() {
        this.stateProps = null;
        this.haveOwnPropsChanged = true;
        this.hasStoreStateChanged = true;
        this.haveStatePropsBeenPrecalculated = false;
        this.statePropsPrecalculationError = null;
        this.renderedElement = null;
        this.finalMapStateToProps = null;
      }

      trySubscribe() {
        if (shouldSubscribe && !this.unsubscribe) {
          const handleChange = this.handleChange.bind(this);
          // TODO: Maybe specify stores so we can get even more specific? What's the perf penalty?
          this.store.emitter.on('change', handleChange);
          this.unsubscribe = () => this.store.emitter.off('change', handleChange);
          this.handleChange();
        }
      }

      tryUnsubscribe() {
        if (this.unsubscribe) {
          this.unsubscribe();
          this.unsubscribe = null;
        }
      }

      handleChange() {
        if (!this.unsubscribe) {
          return;
        }

        const storeState = this.store.getState();
        const prevStoreState = this.state.storeState;
        if (pure && prevStoreState === storeState) {
          return;
        }

        if (pure && !this.doStatePropsDependOnOwnProps) {
          const haveStatePropsChanged = tryCatch(this.updateStatePropsIfNeeded, this);
          if (!haveStatePropsChanged) {
            return;
          }
          if (haveStatePropsChanged === errorObject) {
            this.statePropsPrecalculationError = errorObject.value;
          }
          this.haveStatePropsBeenPrecalculated = true;
        }

        this.hasStoreStateChanged = true;
        this.setState({storeState});
      }

      updateStatePropsIfNeeded() {
        const nextStateProps = this.computeStateProps(this.store, this.props);
        if (this.stateProps && shallowEqual(nextStateProps, this.stateProps)) {
          return false;
        }

        this.stateProps = nextStateProps;
        return true;
      }

      computeStateProps(store: Flux, props: Props): StateProps {
        // Hack to prove to Flow that it can keep the refinement on the next line
        const finalMapStateToProps = this.finalMapStateToProps;
        if (finalMapStateToProps == null) {
          return this.configureFinalMapState(store, props);
        }
        const state = store.getState(); // This fn call can make Flow lose refinement
        const stateProps = this.doStatePropsDependOnOwnProps ?
          finalMapStateToProps.call(this, state, props) :
          finalMapStateToProps.call(this, state);

        if (process.env.NODE_ENV !== 'production') {
          checkStateShape(stateProps, 'mapStateToProps');
        }
        return stateProps;
      }

      // This is from Redux's new memoization technique, where you can pass a function instead.
      // When constructing the function, you have both state & props, but the memoized function you return
      // can, if you like, only rely on state.
      //
      // The reason why we have to call it here is so we can have per-instance, rather than per-class memoization.
      // Otherwise, if we called e.e.g @connect(_.memoize(mapState)), we'd just have memoized per class.
      //
      // Memoization can also help us have pure object identity equality.
      //
      // This can be really useful if we combine with local props. For instance, from another app:
      // export default connect((state, ownProps) => {
      //   return {
      //     image: state.get('images').get('items').find((i) => {
      //       return i.get('id') === ownProps.params.imageId;
      //     })
      //   }
      // })(EditImageLicenseTermsRoute);
      configureFinalMapState(store: Fluxxor.Flux, props: Props): StateProps {
        const mappedState = mapStateToProps(store.getState(), props);
        const isFactory = typeof mappedState === 'function';

        // $FlowIgnore: WTF flow - loses refinement *that* fast?
        this.finalMapStateToProps = isFactory ? mappedState : mapStateToProps;
        // $FlowIgnore: thinks this could be an object because reasons
        this.doStatePropsDependOnOwnProps = this.finalMapStateToProps.length !== 1;

        if (isFactory) {
          return this.computeStateProps(store, props);
        }

        if (process.env.NODE_ENV !== 'production') {
          checkStateShape(mappedState, 'mapStateToProps');
        }
        return mappedState;
      }

      isSubscribed() {
        return typeof this.unsubscribe === 'function';
      }

      getWrappedInstance() {
        invariant(withRef,
          `To access the wrapped instance, you need to specify ` +
          `{ withRef: true } as the second argument of the connect() call.`
        );

        return this.refs.wrappedInstance;
      }

      render() {
        const {
          haveOwnPropsChanged,
          hasStoreStateChanged,
          haveStatePropsBeenPrecalculated,
          statePropsPrecalculationError,
          renderedElement
        } = this;

        this.haveOwnPropsChanged = false;
        this.hasStoreStateChanged = false;
        this.haveStatePropsBeenPrecalculated = false;
        this.statePropsPrecalculationError = null;

        // This is decent, seems a render error here is easier to catch than in the actual building of the
        // component, where it can trash the whole tree.
        if (statePropsPrecalculationError) {
          throw statePropsPrecalculationError;
        }

        let shouldUpdateStateProps = true;
        if (pure && renderedElement) {
          // This is pretty cool - if this is pure, we can decent whether or not to update state props
          // based on whether or not the store has changed. And we know if it depends on our ownProps!
          shouldUpdateStateProps = hasStoreStateChanged || (
            haveOwnPropsChanged && this.doStatePropsDependOnOwnProps
          );
        }

        // Check if stateProps have changed. This depends on whether or not ownProps have changed,
        // which is pretty cool.
        let haveStatePropsChanged = false;
        if (haveStatePropsBeenPrecalculated) {
          haveStatePropsChanged = true;
        } else if (shouldUpdateStateProps) {
          haveStatePropsChanged = this.updateStatePropsIfNeeded();
        }

        // Memoization is rad
        if (!haveStatePropsChanged && !haveOwnPropsChanged && renderedElement) {
          return renderedElement;
        }

        const mergedProps: Props = {
          ...this.stateProps,
          ...this.props,
        };
        // I guess refs are expensive?
        // $FlowIgnore: Doesn't like me mutating this.
        if (withRef) mergedProps.ref = 'wrappedInstance';
        this.renderedElement = React.createElement(WrappedComponent, mergedProps);

        return this.renderedElement;
      }
    }

    if (NODE_ENV !== 'production') {
      // $FlowIgnore: Doesn't like adding to proto
      Connect.prototype.componentWillUpdate = function componentWillUpdate() {
        if (this.version === version) {
          return;
        }

        // We are hot reloading!
        this.version = version;
        this.trySubscribe();
        this.clearCache();
      };
    }

    return hoistStatics(Connect, WrappedComponent);
  };
}
