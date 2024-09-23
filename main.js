const vertexShaderSource = `#version 300 es
    in vec2 position;
    in vec2 texcoord;
    out vec2 screenCoord;
    void main() {
        gl_Position = vec4(position, 0.0, 1.0);
        screenCoord = texcoord;
    }
`;
import fragmentShaderSource from './fragment.glsl?raw';

const N = 32; // playfield size
const START_COIL = 4; // corresponds to the starting length of the snake

// array is passed to the fragment shader for rendering; each cell is a bitmask of BM_* values
// defined below
let cells = new Uint8Array(N * N);

let head, tail;
let gameOver = false;
let appleEatenTimestamp = 0;

// direction vector is updated in tick() while keydown() only appends to nextDirections allowing
// to queue up tight turns
let direction = [-1, 0];
let nextDirections = [];

const BM_TOP = 1; // snake body or wall connecting upwards
const BM_BOT = 2; // snake body or wall connecting downwards
const BM_LEFT = 4; // snake body or wall connecting to the left
const BM_RIGHT = 8; // snake body or wall connecting to the right
const BM_SEG = 16; // snake body or wall segment in the middle of the cell
const BM_APPLE = 32; // bigger rectangle representing the apple to be eaten by the snake

const BM_HORIZONTAL = BM_LEFT | BM_RIGHT | BM_SEG;
const BM_VERTICAL = BM_TOP | BM_BOT | BM_SEG;

// Converts a 2-element direction vector to one of the BM_* constants. Diagonals are not allowed.
let dirToBitmask = function(dir) {
    if (dir[0] === 1) {
        return BM_RIGHT;
    } else if (dir[0] === -1) {
        return BM_LEFT;
    } else if (dir[1] === 1) {
        return BM_TOP;
    } else if (dir[1] === -1) {
        return BM_BOT;
    }
    throw new Error('Invalid direction');
}

// Converts a cell bitmask value to a 2-element direction vector. Exactly one of the BM_TOP, BM_BOT,
// BM_LEFT and BM_RIGHT bits must be set.
let bitmaskToDir = function(bitmask) {
    let result;
    if (bitmask & BM_TOP) {
        result = [0, 1];
        bitmask &= ~BM_TOP;
    } else if (bitmask & BM_BOT) {
        result = [0, -1];
        bitmask &= ~BM_BOT;
    } else if (bitmask & BM_LEFT) {
        result = [-1, 0];
        bitmask &= ~BM_LEFT;
    } else if (bitmask & BM_RIGHT) {
        result = [1, 0];
        bitmask &= ~BM_RIGHT;
    }
    if (!result || (bitmask & (BM_TOP | BM_BOT | BM_LEFT | BM_RIGHT)) !== 0) {
        throw new Error('Invalid bitmask');
    }
    return result;
}

let placeNewApple = function() {
    let x, y;
    do {
        x = Math.floor(Math.random() * N);
        y = Math.floor(Math.random() * N);
    } while (cells[x + N * y] !== 0);
    cells[x + N * y] = BM_APPLE;
}

let initCells = function() {
    cells.fill(0);

    // initial snake: spiral that starts at the center
    tail = [15, 15];
    cells[tail[0] + N * tail[1]] = BM_SEG | BM_RIGHT;
    let p = [16, 15];
    cells[p[0] + N * p[1]] = BM_SEG | BM_LEFT | BM_BOT;
    p[1]--;
    cells[p[0] + N * p[1]] = BM_SEG | BM_TOP | BM_LEFT;
    let steps = 2; // size of the current layer of the spiral
    for (let layer = 0; layer < START_COIL; ++layer) {
        for (let i = 0; i < steps - 1; ++i) {
            p[0]--;
            cells[p[0] + N * p[1]] = BM_HORIZONTAL;
        }
        p[0]--;
        cells[p[0] + N * p[1]] = BM_SEG | BM_RIGHT | BM_TOP;
        for (let i = 0; i < steps - 1; ++i) {
            p[1]++;
            cells[p[0] + N * p[1]] = BM_VERTICAL;
        }
        p[1]++;
        cells[p[0] + N * p[1]] = BM_SEG | BM_BOT | BM_RIGHT;
        steps++;
        for (let i = 0; i < steps - 1; ++i) {
            p[0]++;
            cells[p[0] + N * p[1]] = BM_HORIZONTAL;
        }
        p[0]++;
        cells[p[0] + N * p[1]] = BM_SEG | BM_LEFT | BM_BOT;
        for (let i = 0; i < steps - 1; ++i) {
            p[1]--;
            cells[p[0] + N * p[1]] = BM_VERTICAL;
        }
        p[1]--;
        cells[p[0] + N * p[1]] = BM_SEG | BM_TOP | BM_LEFT;
        steps++;
    }
    head = p;

    // walls around the playfield
    for (let i = 0; i < N; i++) {
        cells[i] = cells[i + N * (N - 1)] = BM_HORIZONTAL;
        cells[i * N] = cells[i * N + N - 1] = BM_VERTICAL;
    }
    cells[0] = BM_TOP | BM_RIGHT | BM_SEG;
    cells[N - 1] = BM_TOP | BM_LEFT | BM_SEG;
    cells[N * (N - 1)] = BM_BOT | BM_RIGHT | BM_SEG;
    cells[N * N - 1] = BM_BOT | BM_LEFT | BM_SEG;

    placeNewApple();
}

let createShaderProgram = function(gl, vertexSource, fragmentSource) {
    let compileShader = function(gl, type, source) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error('Shader compilation error:', gl.getShaderInfoLog(shader));
            gl.deleteShader(shader);
            return null;
        }
        return shader;
    }
    const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
    const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.error('Program linking error:', gl.getProgramInfoLog(program));
        return null;
    }
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    return program;
}

let tick = function() {
    if (gameOver) {
        return;
    }
    if (nextDirections.length > 0) {
        const d = nextDirections.shift();
        // prevent game over on 180 degree turn
        if (!(d[0] === -direction[0] && d[1] === -direction[1])) {
            direction = d;
        }
    }

    cells[head[0] + N * head[1]] |= dirToBitmask(direction);
    head[0] = head[0] + direction[0];
    head[1] = head[1] + direction[1];

    let headIdx = head[0] + N * head[1];
    let frontCell = cells[headIdx];
    if (frontCell & BM_SEG) {
        gameOver = true;
        return;
    }
    cells[headIdx] = BM_SEG | dirToBitmask([-direction[0], -direction[1]]);

    if (frontCell & BM_APPLE) {
        appleEatenTimestamp = performance.now();
        placeNewApple();
    } else {
        // remove tail segment
        let tailIdx = tail[0] + N * tail[1];
        let tailCell = cells[tailIdx];
        let tailDir = bitmaskToDir(tailCell);
        cells[tailIdx] = 0; // clear old tail cell completely

        // advance the tail
        tail[0] = tail[0] + tailDir[0];
        tail[1] = tail[1] + tailDir[1];
        tailIdx = tail[0] + N * tail[1];

        // new tail cell value needs to be updated so that it contains only BM_SEG and one of the
        // directional bits
        cells[tailIdx] &= ~dirToBitmask([-tailDir[0], -tailDir[1]]);
    }
}

let keydown = function(event) {
    const KEY_DIR = {
        'ArrowUp': [0, 1],
        'ArrowDown': [0, -1],
        'ArrowLeft': [-1, 0],
        'ArrowRight': [1, 0]
    };
    let dir = KEY_DIR[event.key];
    if (dir && nextDirections.length < 5) {
        nextDirections.push(dir);
    }
}

let onload = function() {
    const canvas = document.getElementById('glCanvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) {
        console.error('WebGL 2 not supported');
        return;
    }

    initCells();

    const shader = createShaderProgram(gl, vertexShaderSource, fragmentShaderSource);
    if (!shader) {
        return;
    }

    const vertices = new Float32Array([
        -1.0, -1.0, 0.0, 0.0,
        1.0, -1.0, 1.0, 0.0,
        1.0, 1.0, 1.0, 1.0,
        -1.0, 1.0, 0.0, 1.0
    ]);

    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);

    const positionLocation = gl.getAttribLocation(shader, 'position');
    const texcoordLocation = gl.getAttribLocation(shader, 'texcoord');

    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(texcoordLocation);
    gl.vertexAttribPointer(texcoordLocation, 2, gl.FLOAT, false, 16, 8);

    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const _loc_N = gl.getUniformLocation(shader, 'N');
    const _loc_timestamp = gl.getUniformLocation(shader, 'timestamp');

    function render(timestamp) {
        gl.clearColor(0.0, 0.0, 0.0, 1.0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.useProgram(shader);
        gl.uniform1i(_loc_N, N);
        if (gameOver) {
            // no noise shown on the game over screen
            gl.uniform1f(_loc_timestamp, 1.0);
        } else {
            gl.uniform1f(_loc_timestamp, (timestamp - appleEatenTimestamp) / 1000);
        }

        gl.bindVertexArray(vao);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8UI, N, N, 0, gl.RED_INTEGER, gl.UNSIGNED_BYTE, cells);

        gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);

        requestAnimationFrame(render);
    }

    requestAnimationFrame(render);
    setInterval(tick, 100);
    document.addEventListener('keydown', keydown);
}

window.onload = onload;
