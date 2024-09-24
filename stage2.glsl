#version 300 es

precision mediump float;

uniform sampler2D stageIn;
uniform float timestamp;
in vec2 screenCoord;
out vec4 fragColor;

const float WARP = 0.8;

void main() {
    vec2 coord = screenCoord;
    vec2 dc = abs(0.5 - coord);
    dc *= dc;
    coord.x -= 0.5; coord.x *= 1.0 + (dc.y * (0.3 * WARP)); coord.x += 0.5;
    coord.y -= 0.5; coord.y *= 1.0 + (dc.x * (0.4 * WARP)); coord.y += 0.5;
    if (!(all(greaterThan(coord, vec2(0.0))) && all(lessThan(coord, vec2(1.0))))) {
        discard;
    }

    vec3 color = texture(stageIn, coord).rgb;

    // apply a slight vignette effect
    color *= 0.5 + 0.5 * clamp(1.0 - (3.0 * length(dc)), 0.0, 1.0);

    fragColor = vec4(color, 1.0);
}
