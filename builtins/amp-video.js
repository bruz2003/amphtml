/**
 * Copyright 2015 The AMP HTML Authors. All Rights Reserved.
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

import {BaseElement} from '../src/base-element';
import {listenOncePromise} from '../src/event-helper';
import {assertHttpsUrl} from '../src/url';
import {isLayoutSizeDefined} from '../src/layout';
import {loadPromise} from '../src/event-helper';
import {registerElement} from '../src/custom-element';
import {getMode} from '../src/mode';
import {VideoEvents} from '../src/video-interface';
import {videoManagerForDoc} from '../src/video-manager';

/**
 * @param {!Window} win Destination window for the new element.
 * @this {undefined}  // Make linter happy
 * @return {undefined}
 */
export function installVideo(win) {

  /**
   * @implements {../src/video-interface.VideoInterface}
   */
  class AmpVideo extends BaseElement {

    /** @override */
    isLayoutSupported(layout) {
      return isLayoutSizeDefined(layout);
    }

    /** @override */
    buildCallback() {
      /** @private @const {!HTMLVideoElement} */
      this.video_ = this.element.ownerDocument.createElement('video');

      const posterAttr = this.element.getAttribute('poster');
      if (!posterAttr && getMode().development) {
        console/*OK*/.error(
            'No "poster" attribute has been provided for amp-video.');
      }

      videoManagerForDoc(this.win.document).register(this);

      // Disable video preload in prerender mode.
      this.video_.setAttribute('preload', 'none');
      this.propagateAttributes(['poster', 'controls'], this.video_);
      this.applyFillContent(this.video_, true);
      this.element.appendChild(this.video_);

      this.element.dispatchCustomEvent(VideoEvents.BUILT);
    }

    /** @override */
    viewportCallback(visible) {
      this.element.dispatchCustomEvent(VideoEvents.VISIBILITY, {visible});
    }

    /** @override */
    layoutCallback() {
      if (!this.isVideoSupported_()) {
        this.toggleFallback(true);
        return Promise.resolve();
      }

      if (this.element.getAttribute('src')) {
        assertHttpsUrl(this.element.getAttribute('src'), this.element);
      }

      listenOncePromise(this.video_, 'canplay').then(() => {
        this.element.dispatchCustomEvent(VideoEvents.CAN_PLAY);
      });

      // Do not propagate `autoplay`. Autoplay behaviour is managed by
      // video manager since amp-video implements the VideoInterface
      this.propagateAttributes(
          ['src', 'muted', 'loop'],
          this.video_);

      if (this.element.hasAttribute('preload')) {
        this.video_.setAttribute(
            'preload', this.element.getAttribute('preload'));
      } else {
        this.video_.removeAttribute('preload');
      }

      this.getRealChildNodes().forEach(child => {
        // Skip the video we already added to the element.
        if (this.video_ === child) {
          return;
        }
        if (child.getAttribute && child.getAttribute('src')) {
          assertHttpsUrl(child.getAttribute('src'), child);
        }
        this.video_.appendChild(child);
      });

      return loadPromise(this.video_);
    }

    /** @override */
    pauseCallback() {
      if (this.video_) {
        this.video_.pause();
      }
    }

    /** @private */
    isVideoSupported_() {
      return !!this.video_.play;
    }

    /**
     * VideoInterface Implementation
     * {@see ../src/video-interface.VideoInterface}
     */

    /**
     * @return {boolean}
     */
    supportsPlatform() {
      return this.isVideoSupported_();
    }

    /**
     * @return {boolean}
     */
    hasAutoplay() {
      return this.element.hasAttribute('autoplay');
    }

    /**
     * @return {!Promise}
     */
    play(unusedIsAutoplay) {
      this.video_.play();
      return listenOncePromise(this.video_, 'play');
    }

    /**
     * @return {!Promise}
     */
    pause() {
      this.video_.pause();
      return listenOncePromise(this.video_, 'pause');
    }

    /**
     * @return {!Promise}
     */
    mute() {
      this.video_.setAttribute('muted', '');
      return Promise.resolve();
    }

    /**
     * @return {!Promise}
     */
    unmute() {
      this.video_.removeAttribute('muted');
      return Promise.resolve();
    }

    /**
     * @return {boolean}
     */
    hasControls() {
      return this.element.hasAttribute('controls');
    }

    /**
     * @return {!Promise}
     */
    showControls() {
      this.video_.setAttribute('controls', '');
      return Promise.resolve();
    }

    /**
     * @return {!Promise}
     */
    hideControls() {
      this.video_.removeAttribute('controls');
      return Promise.resolve();
    }
  }

  registerElement(win, 'amp-video', AmpVideo);
}
