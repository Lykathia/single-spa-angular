/* eslint-disable @typescript-eslint/no-use-before-define */

const defaultOpts = {
  // required opts
  bootstrapFunction: null,
  template: null,
  // optional opts
  Router: null,
  ApplicationRef: null,
  domElementGetter: null, // only optional if you provide a domElementGetter as a custom prop
};

export default function singleSpaAngular(userOpts) {
  if (typeof userOpts !== "object") {
    throw Error("single-spa-angular requires a configuration object");
  }

  const opts = {
    ...defaultOpts,
    ...userOpts,
  };

  if (typeof opts.bootstrapFunction !== 'function') {
    throw Error("single-spa-angular must be passed an opts.bootstrapFunction")
  }

  if (typeof opts.template !== "string") {
    throw Error("single-spa-angular must be passed opts.template string");
  }

  if (opts.Router && !opts.ApplicationRef || opts.ApplicationRef && !opts.Router) {
    throw Error("For @angular/router to work with single-spa, you must provide both the Router and ApplicationRef opts");
  }

  if (!opts.NgZone) {
    throw Error(`single-spa-angular must be passed the NgZone opt`);
  }

  return {
    bootstrap: bootstrap.bind(null, opts),
    mount: mount.bind(null, opts),
    unmount: unmount.bind(null, opts),
  };
}

function bootstrap(opts, props) {
  return Promise.resolve().then(() => {
    // In order for multiple Angular apps to work concurrently on a page, they each need a unique identifier.
    opts.zoneIdentifier = `single-spa-angular:${props.name || props.appName}`;

    // This is a hack, since NgZone doesn't allow you to configure the property that identifies your zone.
    // See https://github.com/PlaceMe-SAS/single-spa-angular-cli/issues/33,
    // https://github.com/CanopyTax/single-spa-angular/issues/47,
    // https://github.com/angular/angular/blob/a14dc2d7a4821a19f20a9547053a5734798f541e/packages/core/src/zone/ng_zone.ts#L144,
    // and https://github.com/angular/angular/blob/a14dc2d7a4821a19f20a9547053a5734798f541e/packages/core/src/zone/ng_zone.ts#L257
    opts.NgZone.isInAngularZone = function() {
      // @ts-ignore
      return window.Zone.current.get(opts.zoneIdentifier) === 'true';
    }

    opts.routingEventListener = function() {
      /* When popstate and hashchange events occur, single-spa delays them in order to
       * check which applications should be active and perform any necessary mounting/unmounting.
       *
       * ZoneJS freaks out about this because it hears about the events but it wasn't inside of a
       * Zone.current.run() block (or similar). I tried out modifying single-spa to call the event listener
       * inside of a Zone.run() block, but that didn't seem to help. I think if we could get that working
       * that it would be the best solution.
       *
       * I also tried out trying to detect with single-spa:routing-event events are the ones that actually
       * need to trigger an application tick, since not every one of them does. But I wasn't able to find a reliable
       * way of detecting it. So I fell back to just always causing an application tick, even though that's probably
       * not great for performance.
       */
      const applicationRef = opts.bootstrappedModule.injector.get(opts.ApplicationRef);
      applicationRef.tick();
    };
  });
}

function mount(opts, props) {
  return Promise
    .resolve()
    .then(() => {
      const domElementGetter = chooseDomElementGetter(opts, props);
      if (!domElementGetter) {
        throw Error(`cannot mount angular application '${props.name || props.appName}' without a domElementGetter provided either as an opt or a prop`);
      }

      const containerEl = getContainerEl(domElementGetter);
      containerEl.innerHTML = opts.template;
    })
    .then(() => {
      const bootstrapPromise = opts.bootstrapFunction()
      if (!(bootstrapPromise instanceof Promise)) {
        throw Error(`single-spa-angular: the opts.bootstrapFunction must return a promise, but instead returned a '${typeof bootstrapPromise}' that is not a Promise`);
      }

      return bootstrapPromise.then(module => {
        if (!module || typeof module.destroy !== 'function') {
          throw Error(`single-spa-angular: the opts.bootstrapFunction returned a promise that did not resolve with a valid Angular module. Did you call platformBrowser().bootstrapModuleFactory() correctly?`)
        }
        module.injector.get(opts.NgZone)._inner._properties[opts.zoneIdentifier] = true;
        
        opts.bootstrappedModule = module;
        if (opts.ApplicationRef) {
          window.addEventListener("single-spa:routing-event", opts.routingEventListener);
        }
        return module;
      });
    });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function unmount(opts, props) {
  return Promise.resolve().then(() => {
    if (opts.Router) {
      // Workaround for https://github.com/angular/angular/issues/19079
      const routerRef = opts.bootstrappedModule.injector.get(opts.Router);
      routerRef.dispose();
    }
    if (opts.ApplicationRef) {
      window.removeEventListener("single-spa:routing-event", opts.routingEventListener);
    }
    opts.bootstrappedModule.destroy();
    delete opts.bootstrappedModule;
  });
}

function getContainerEl(domElementGetter) {
  const element = domElementGetter();
  if (!element) {
    throw Error("domElementGetter did not return a valid dom element");
  }

  return element;
}

function chooseDomElementGetter(opts, props) {
  if (props && props.customProps && props.customProps.domElementGetter) {
    return props.customProps.domElementGetter;
  } else if (opts.domElementGetter) {
    return opts.domElementGetter;
  } else {
    return defaultDomElementGetter(props.name);
  }
}

function defaultDomElementGetter(name) {
  return function getDefaultDomElement() {
    const id = `single-spa-application:${name}`;
    let domElement = document.getElementById(id);
    if (!domElement) {
      domElement = document.createElement('div');
      domElement.id = id;
      document.body.appendChild(domElement);
    }

    return domElement;
  }
}