/* ==========================================================================
   event-bus.js — Lightweight publish/subscribe event bus for decoupled
   module communication. Replaces direct callback wiring between modules.

   Events:
     filters:changed   — Any filter dropdown changed  (payload: filterState)
     system:add        — User clicked "+" on schedule  (payload: systemId)
     project:changed   — Project entries changed       (payload: projectIds Set)
     product:switching  — Product tab switch starting   (payload: productKey)
     product:switched   — Product tab switch complete   (payload: productKey)
     app:loading        — Toggle loading overlay        (payload: boolean)
   ========================================================================== */

const EventBus = (function () {

    "use strict";

    var _listeners = {};

    /**
     * Subscribe to an event.
     * Returns an unsubscribe function for convenience.
     */
    function on(event, fn) {
        if (!_listeners[event]) {
            _listeners[event] = [];
        }
        _listeners[event].push(fn);

        // Return unsubscribe function
        return function () {
            off(event, fn);
        };
    }

    /**
     * Unsubscribe a specific handler from an event.
     */
    function off(event, fn) {
        if (!_listeners[event]) return;
        _listeners[event] = _listeners[event].filter(function (listener) {
            return listener !== fn;
        });
    }

    /**
     * Emit an event with optional data payload.
     * All registered handlers are called synchronously.
     */
    function emit(event, data) {
        if (!_listeners[event]) return;
        var handlers = _listeners[event].slice(); // snapshot to avoid mutation issues
        for (var i = 0; i < handlers.length; i++) {
            try {
                handlers[i](data);
            } catch (err) {
                console.error("[EventBus] Error in handler for '" + event + "':", err);
            }
        }
    }

    /**
     * Remove all listeners for a specific event, or all events if no event given.
     */
    function clear(event) {
        if (event) {
            delete _listeners[event];
        } else {
            _listeners = {};
        }
    }

    // -----------------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------------
    return {
        on:    on,
        off:   off,
        emit:  emit,
        clear: clear,
    };

})();
