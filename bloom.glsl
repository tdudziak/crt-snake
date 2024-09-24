#version 300 es

precision mediump float;

uniform sampler2D stageIn;
uniform float timestamp;
in vec2 screenCoord;
out vec4 fragColor;

const float COEF_CENTER = 0.21825;
const vec3 HALF_KERNEL = vec3(0.21875, 0.109375, 0.03125);

float inAt(vec2 dxy) {
    return texture(stageIn, screenCoord + dxy).r;
}

float flicker(float t_on, float t_off) {
    float t = mod(timestamp, t_on + t_off);
    return float(t < t_on);
}

void main() {
    float rand = fract(sin(timestamp * 12.9898) * 43758.5453);

    vec2 dxy = vec2(
        0.002 * (1.0 + 2.0 * flicker(0.1, 3.0 + rand * 3.0)),
        0.0
    );

    float in_center = inAt(vec2(0.0));
    vec3 in_left = vec3(inAt(-1.0 * dxy), inAt(-2.0 * dxy), inAt(-3.0 * dxy));
    vec3 in_right = vec3(inAt(1.0 * dxy), inAt(2.0 * dxy), inAt(3.0 * dxy));

    float result = dot(HALF_KERNEL, in_left + in_right) + COEF_CENTER * in_center;
    fragColor = vec4(result, result, result, 1.0);
}
