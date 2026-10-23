"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TagState = void 0;
/** Configuration snapshot. Events and callbacks must never be replayed after a crash. */
class TagState {
    defaults = {};
    consent = {};
    settings = {};
    configurations = new Map();
    started = false;
    remember(args) {
        const [command, target, values] = args;
        const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
        if (command === 'js')
            this.started = true;
        if (command === 'consent' && object(values)) {
            if (target === 'default')
                Object.assign(this.defaults, values);
            if (target === 'update')
                Object.assign(this.consent, values);
        }
        if (command === 'set') {
            if (object(target))
                Object.assign(this.settings, target);
            else if (typeof target === 'string')
                this.settings[target] = values;
        }
        if (command === 'config' && typeof target === 'string' && (values === undefined || object(values))) {
            this.configurations.set(target, { ...this.configurations.get(target), ...(values ?? {}) });
        }
    }
    replay() {
        const commands = [];
        if (Object.keys(this.defaults).length)
            commands.push(['consent', 'default', this.defaults]);
        if (Object.keys(this.consent).length)
            commands.push(['consent', 'update', this.consent]);
        if (this.started)
            commands.push(['js', new Date().toISOString()]);
        if (Object.keys(this.settings).length)
            commands.push(['set', this.settings]);
        for (const [id, config] of this.configurations) {
            // The Google tag must rebuild its state, without counting another page view.
            const { update: _update, ...initial } = config;
            commands.push(['config', id, { ...initial, send_page_view: false }]);
        }
        // Do not revive callback markers from previously completed commands.
        return JSON.parse(JSON.stringify(commands, (_key, value) => value && typeof value === 'object' && '__electron_ga4_callback__' in value ? undefined : value));
    }
}
exports.TagState = TagState;
