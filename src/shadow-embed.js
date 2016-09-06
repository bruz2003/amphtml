/**
 * Copyright 2016 The AMP HTML Authors. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS-IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {ShadowCSS} from '../third_party/webcomponentsjs/ShadowCSS';
import {ampdocFor} from './ampdoc';
import {dev} from './log';
import {escapeCssSelectorIdent} from './dom';
import {extensionsFor} from './extensions';
import {insertStyleElement} from './style-installer';


/** @const {!RegExp} */
const CSS_SELECTOR_BEG_REGEX = /[^\.\-\_0-9a-zA-Z]/;

/** @const {!RegExp} */
const CSS_SELECTOR_END_REGEX = /[^\-\_0-9a-zA-Z]/;


/**
 * @type {boolean|undefined}
 * @visiblefortesting
 */
let shadowDomSupported;

/**
 * @param {boolean|undefined} val
 * @visiblefortesting
 */
export function setShadowDomSupportedForTesting(val) {
  shadowDomSupported = val;
}

/**
 * Returns `true` if the Shadow DOM is supported.
 * @return {boolean}
 */
export function isShadowDomSupported() {
  if (shadowDomSupported === undefined) {
    shadowDomSupported = !!Element.prototype.createShadowRoot;
  }
  return shadowDomSupported;
}


/**
 * Creates a shadow root for the specified host and returns it. Polyfills
 * shadow root creation if necessary.
 * @param {!Element} hostElement
 * @return {!ShadowRoot}
 */
export function createShadowRoot(hostElement) {
  const existingRoot = hostElement.shadowRoot || hostElement.__AMP_SHADOW_ROOT;
  if (existingRoot) {
    existingRoot./*OK*/innerHTML = '';
    return existingRoot;
  }

  // Native support.
  if (isShadowDomSupported()) {
    return hostElement.createShadowRoot();
  }

  // Polyfill.
  return createShadowRootPolyfill(hostElement);
}


/**
 * Shadow root polyfill.
 * @param {!Element} hostElement
 * @return {!ShadowRoot}
 */
function createShadowRootPolyfill(hostElement) {
  const doc = hostElement.ownerDocument;
  const win = doc.defaultView;
  const shadowRoot = doc.createElement('i-amp-shadow-root');
  shadowRoot.id = 'i-amp-sd-' + Math.floor(win.Math.random() * 10000);
  hostElement.appendChild(shadowRoot);
  hostElement.shadowRoot = hostElement.__AMP_SHADOW_ROOT = shadowRoot;

  // API: https://www.w3.org/TR/shadow-dom/#the-shadowroot-interface

  /** @type {!Element} */
  shadowRoot.host = hostElement;

  /** @type {function(string):?Element} */
  shadowRoot.getElementById = function(id) {
    const escapedId = escapeCssSelectorIdent(win, id);
    return shadowRoot.querySelector(`#${escapedId}`);
  };

  return shadowRoot;
}


/**
 * Creates a shadow root for an shadow embed.
 * @param {!Element} hostElement
 * @param {!Array<string>} extensionIds
 * @return {!ShadowRoot}
 */
export function createShadowEmbedRoot(hostElement, extensionIds) {
  const shadowRoot = createShadowRoot(hostElement);
  shadowRoot.AMP = {};

  const win = hostElement.ownerDocument.defaultView;
  const extensions = extensionsFor(win);
  const ampdocService = ampdocFor(win);
  const ampdoc = ampdocService.getAmpDoc(hostElement);

  // Instal runtime CSS.
  copyRuntimeStylesToShadowRoot(ampdoc, shadowRoot);

  // Install extensions.
  extensionIds.forEach(extensionId => extensions.loadExtension(extensionId));

  // Apply extensions factories, such as CSS.
  extensions.installFactoriesInShadowRoot(shadowRoot, extensionIds);

  return shadowRoot;
}


/**
 * Imports a body into a shadow root with the workaround for a polyfill case.
 * @param {!ShadowRoot} shadowRoot
 * @param {!Element} body
 * @return {!Element}
 */
export function importShadowBody(shadowRoot, body) {
  const doc = shadowRoot.ownerDocument;
  let resultBody;
  if (isShadowDomSupported()) {
    resultBody = doc.importNode(body, true);
  } else {
    resultBody = doc.createElement('amp-body');
    for (let n = body.firstChild; !!n; n = n.nextSibling) {
      resultBody.appendChild(doc.importNode(n, true));
    }
    resultBody.style.display = 'block';
  }
  resultBody.style.position = 'relative';
  shadowRoot.appendChild(resultBody);
  return resultBody;
}


/**
 * Adds the given css text to the given shadow root.
 *
 * The style tags will be at the beginning of the shadow root before all author
 * styles. One element can be the main runtime CSS. This is guaranteed
 * to always be the first stylesheet in the doc.
 *
 * @param {!ShadowRoot} shadowRoot
 * @param {string} cssText
 * @param {boolean=} opt_isRuntimeCss If true, this style tag will be inserted
 *     as the first element in head and all style elements will be positioned
 *     after.
 * @param {string=} opt_ext
 * @return {!HTMLStyleElement}
 */
export function installStylesForShadowRoot(shadowRoot, cssText,
    opt_isRuntimeCss, opt_ext) {
  return insertStyleElement(
      shadowRoot.ownerDocument,
      shadowRoot,
      transformShadowCss(shadowRoot, cssText),
      opt_isRuntimeCss || false,
      opt_ext || null);
}


/*
 * Copies runtime styles from the ampdoc context into a shadow root.
 * @param {!./service/ampdoc-impl.AmpDoc} ampdoc
 * @param {!ShadowRoot} shadowRoot
 */
export function copyRuntimeStylesToShadowRoot(ampdoc, shadowRoot) {
  const style = dev().assert(
      ampdoc.getRootNode().querySelector('style[amp-runtime]'),
      'Runtime style is not found in the ampdoc: %s', ampdoc.getRootNode());
  const cssText = style.textContent;
  installStylesForShadowRoot(shadowRoot, cssText, /* opt_isRuntimeCss */ true);
}


/**
 * If necessary, transforms CSS to isolate AMP CSS within the shaodw root and
 * reduce the possibility of high-level conflicts.
 * @param {!ShadowRoot} shadowRoot
 * @param {string} css
 * @return {string}
 */
export function transformShadowCss(shadowRoot, css) {
  if (isShadowDomSupported()) {
    return css;
  }
  return scopeShadowCss(shadowRoot, css);
}


/**
 * Transforms CSS to isolate AMP CSS within the shadow root and reduce the
 * possibility of high-level conflicts. There are two types of transformations:
 * 1. Root transformation: `body` -> `amp-body`, etc.
 * 2. Scoping: `a {}` -> `#i-amp-sd-123 a {}`.
 *
 * @param {!ShadowRoot} shadowRoot
 * @param {string} css
 * @return {string}
 * @visibleForTesting
 */
export function scopeShadowCss(shadowRoot, css) {
  const id = dev().assert(shadowRoot.id);
  const doc = shadowRoot.ownerDocument;
  let rules = null;
  // Try to use a separate document.
  try {
    rules = getStylesheetRules(doc.implementation.createHTMLDocument(''), css);
  } catch (e) {
    // Ignore.
  }
  // Try to use the current document.
  if (!rules) {
    try {
      rules = getStylesheetRules(doc, css);
    } catch (e) {
      // Ignore.
    }
  }

  // No rules could be parsed - return css as is.
  if (!rules) {
    return css;
  }

  // Patch selectors.
  return ShadowCSS.scopeRules(rules, `#${id}`, transformRootSelectors);
}


/**
 * Replaces top-level selectors such as `html` and `body` with their polyfill
 * counterparts: `amp-html` and `amp-body`.
 * @param {string} selector
 * @return {string}
 */
function transformRootSelectors(selector) {
  return selector.replace(/(html|body)/g, rootSelectorPrefixer);
}


/**
 * See `transformRootSelectors`.
 * @param {string} match
 * @param {string} name
 * @param {number} pos
 * @param {string} selector
 * @return {string}
 * @private
 */
function rootSelectorPrefixer(match, name, pos, selector) {
  const prev = selector.charAt(pos - 1);
  const next = selector.charAt(pos + match.length);
  if ((!prev || CSS_SELECTOR_BEG_REGEX.test(prev)) &&
      (!next || CSS_SELECTOR_END_REGEX.test(next))) {
    return 'amp-' + match;
  }
  return match;
}



/**
 * @param {!Document} doc
 * @param {string} css
 * @return {?CSSRuleList}
 */
function getStylesheetRules(doc, css) {
  const style = doc.createElement('style');
  style.textContent = css;
  try {
    (doc.head || doc.documentElement).appendChild(style);
    if (style.sheet) {
      return style.sheet.cssRules;
    }
    return null;
  } finally {
    if (style.parentNode) {
      style.parentNode.removeChild(style);
    }
  }
}
