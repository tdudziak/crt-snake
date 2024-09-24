#version 300 es

precision mediump float;

uniform sampler2D stageIn;
uniform float timestamp;
uniform vec2 bloomAxis;
uniform float noiseLevel;

in vec2 screenCoord;
out vec4 fragColor;

const float COEF_CENTER = 0.3;
const vec3 HALF_KERNEL = vec3(0.3, 0.1, 0.05);

float inAt(vec2 dxy) {
    return texture(stageIn, screenCoord + dxy).r;
}

void main() {
    float dc = dot(0.5 - screenCoord, 0.5 - screenCoord);
    vec2 dxy = bloomAxis * 0.0015 * (1.0 + 2.0 * dc);
    float in_center = texture(stageIn, screenCoord).r;
    vec3 in_left = vec3(inAt(-1.0 * dxy), inAt(-2.0 * dxy), inAt(-3.0 * dxy));
    vec3 in_right = vec3(inAt(1.0 * dxy), inAt(2.0 * dxy), inAt(3.0 * dxy));

    float result = dot(HALF_KERNEL, in_left + in_right) + COEF_CENTER * in_center;
    fragColor = vec4(result, result, result, 1.0);
}
