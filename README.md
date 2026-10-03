# NO CLEARANCE

A brutally unforgiving first-person sci-fi flight simulator about illegally escaping a heavily controlled planet.
You are the pilot of a government-certified passenger shuttle. Take off, look legitimate, divert, evacuate the
passengers, jettison most of the ship, disappear from tracking, survive the ascent and jump.
There is no tutorial. Every switch works. Nothing stops you from doing the wrong thing.

```
npm install
npm run dev      # play at http://localhost:5173
npm run build    # static build in dist/
npm test
```

Desktop browser with WebGL 2 (Chrome / Edge / Firefox; Safari where WebGL2 is available).

**Hands:** the mouse is your head; the reticle is your gaze. LMB operates a control (drag levers, knobs and pull
handles), RMB reverses a switch, the wheel turns knobs or zooms. Click the stick to take hold of it; the mouse
then flies, LMB lets go, hold RMB to look around. Keyboard alternatives: W/A/S/D stick, Q/E rudder, R/F throttle,
B brakes, I/K/J/L/U/O RCS translation, Space recentres the view, Esc pauses.

See `PROJECT_STATE.md` for architecture, physics model, balancing constants and status.
