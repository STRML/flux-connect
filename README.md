# Flux-Connect

A `@connect` decorator for any Flux app.

> This connector is very much alpha. To use it, please simply copy/paste into your app until I have the time
  to put together a proper ES5 build.

### Usage

```js
import {connect, Provider} from 'flux-connect';
import * as AppActions from 'project/actions/index';
// ...

type AppState = {actions: typeof AppActions, books: Array<Book>, user: User};

@connect((state) => {user: state.user, buyBook: state.actions.buyBook})
class App extends React.Component {
  props: {
    user: AppState.user
  };

  render() {
    return React.createElement('div', {onClick: this.props.buyBook}, `Buy my book, ${user.username}!`);
  }
}

function fluxToData(flux: Flux): AppState {
  return {
    actions: flux.actions,
    books: stores.UserStore.getBooks(),
    user: stores.UserStore.getUser()
  };
}

// Init Fluxxor in your usual way
const flux = initFlux();

const mainView = React.createElement(Provider, {fluxToData}, React.createElement(App));
ReactDOM.render(mainView, document.getElementById("content"));
```

### Overview

Much like [React-Redux](https://github.com/reactjs/react-redux), `flux-connect` exposes a
`@connect(mapStateToProps, options)` decorator and a `<Provider>` that exposes app state
through context.

Unlike React-Redux's `@connect`, for simplicity, this component does not expose a `mapDispatchToProps` or
a `mergeProps` function.

### Type Signatures

> In the near future, Flow will be able to typecheck decorators.
> Until then, you can use the `connect(mergeStateToProps)(Component)` form,
> which Flow can actually typecheck.

The following types are available and can be imported:

```js
type StateMapper<Props, U: $Shape<Props>> = (state: AppState, props: ?Props) => U;
type ConnectOptions = {pure?: boolean, withRef?: boolean};
```

**Connect Signature**:

```js
export default function connect<StateProps, DefaultProps, Props, T: _ReactClass<DefaultProps, Props, *, *>>(
    mapStateToProps: StateMapper<Props, StateProps>, options: ConnectOptions = {})
    : (WrappedComponent: T) => Class<React.Component<DefaultProps, $Diff<Props, StateProps>, *>>
```

### Using Connect with Flow

Unfortunately, there's not a great way to pass type parameters to imported functions.

To get Flow to typecheck the input and output of `connect()`, you'll have to typecast it:

```js
import {connect, Provider} from 'flux-connect';
import type {AppState} from 'ui/types';

(Provider: Provider<Flux>) // To get typechecking on fluxToState
(connect: connect<AppState>) // To get typechecking on `mapStateToProps`
class App extends React.Component {
  // ...
}
// Don't use the decorator until Flow is actually typechecking them.
// As of `0.23.0` it can parse decorators, but does not typecheck.
export default connect((state) => {user: state.user});
```
