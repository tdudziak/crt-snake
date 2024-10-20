import { initShaders } from './shaders.js';

const N = 32; // playfield size
const TIME_LIMIT = 10; // max noise this many seconds after each score
const GROWTH_RATIO = 1.4; // how much the snake grows after eating an apple

// array is passed to the fragment shader for rendering; each cell is a bitmask of BM_* values
// defined below
let cells = new Uint8Array(N * N);

let head, tail;
let gameOver;
let appleEatenTimestamp;
let pendingGrowth, currentLength;

// direction vector is updated in tick() while onKeydown() only appends to nextDirections allowing
// to queue up tight turns
let direction;
let nextDirections;

const BM_TOP = 1; // snake body or wall connecting upwards
const BM_BOT = 2; // snake body or wall connecting downwards
const BM_LEFT = 4; // snake body or wall connecting to the left
const BM_RIGHT = 8; // snake body or wall connecting to the right
const BM_SEG = 16; // snake body or wall segment in the middle of the cell
const BM_APPLE = 32; // bigger rectangle representing the apple to be eaten by the snake

const BM_HORIZONTAL = BM_LEFT | BM_RIGHT | BM_SEG;
const BM_VERTICAL = BM_TOP | BM_BOT | BM_SEG;

// Converts a 2-element direction vector to one of the BM_* constants. Diagonals are not allowed.
function dirToBitmask(dir) {
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
function bitmaskToDir(bitmask) {
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

function wallDistance(x, y) {
    let visited = new Uint8Array(N * N);
    let queue = [[x, y, 0]];
    while (queue.length > 0) {
        const [x, y, d] = queue.shift();
        const idx = x + N * y;
        visited[idx] = 1;
        if (cells[idx] != 0) {
            return d;
        }
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = x + dx;
            const ny = y + dy;
            const nidx = nx + N * ny;
            if (nx >= 0 && nx < N && ny >= 0 && ny < N && !visited[nidx]) {
                queue.push([nx, ny, d + 1]);
            }
        }
    }
    return Infinity;
}

function reachableCells() {
    let result = []
    let visited = new Uint8Array(N * N);
    let queue = [head];
    while (queue.length > 0) {
        const [x, y] = queue.shift();
        const idx = x + N * y;
        if (visited[idx]) {
            continue;
        }
        visited[idx] = 1;
        result.push([x, y]);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || nx >= N || ny < 0 || ny >= N) {
                continue;
            }
            const nidx = nx + N * ny;
            if (visited[nidx] || cells[nidx] != 0) {
                continue;
            }
            queue.push([nx, ny]);
        }
    }
    return result;
}

function placeNewApple() {
    const reachable = reachableCells();
    if (reachable.length < pendingGrowth + 5) {
        // not many reachable free cells left, game will be over soon anyway
        return;
    }

    // try to find a random free cell away from any obstacles
    let [x, y] = reachable[0];
    let distance = 0;
    for (let i = 0; i < 7; ++i) {
        const [nx, ny] = reachable[Math.floor(Math.random() * reachable.length)];
        const nd = wallDistance(nx, ny);
        if (nd > distance) {
            distance = nd;
            x = nx;
            y = ny;
        }
    }

    cells[x + N * y] = BM_APPLE;
}

// Wraps event handlers, render functions, and other entry points so that an error message is shown
// when an exception is thrown.
function showErrorOnFailure(f) {
    return function(...args) {
        try {
            return f(...args);
        } catch (e) {
            console.error(e);
            document.getElementById('glCanvas').style.display = 'none';
            document.getElementById('errorMessage').style.display = 'block';
        }
    }
}

function restartGame() {
    gameOver = false;
    appleEatenTimestamp = document.timeline.currentTime;
    pendingGrowth = 0;
    currentLength = 2;
    direction = [1, 0];
    nextDirections = [];
    cells.fill(0);

    // initial snake: spiral that starts at the center
    tail = [Math.floor(N / 2), Math.floor(N / 2)];
    cells[tail[0] + N * tail[1]] = BM_SEG | BM_RIGHT;
    head = [tail[0] + 1, tail[1]];
    cells[head[0] + N * head[1]] = BM_SEG | BM_LEFT;

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

function drawGameOverScreen() {
    const nonglCanvas = document.getElementById('nonglCanvas');
    const textCtx = nonglCanvas.getContext('2d');
    const width = nonglCanvas.width;
    const height = nonglCanvas.height;

    textCtx.clearRect(0, 0, width, height);

    textCtx.fillStyle = 'rgba(0, 0, 0, 0.9)';
    textCtx.fillRect(0, 25, width, 26);
    textCtx.fillRect(0, 69, width, 21);

    textCtx.font = '20px monospace';
    textCtx.fillStyle = 'white';
    textCtx.textAlign = 'center';
    textCtx.textBaseline = 'middle';
    textCtx.fillText('GAME OVER', width / 2, 40);
    textCtx.font = '16px monospace';

    // score is close to currentLength since N * N is normally 1024 but we normalize it to the
    // rounder maximal value of 1000
    const score = Math.round(1000.0 * currentLength / (N * N));
    textCtx.fillText(`SCORE: ${score}`, width / 2, 80);
}

const tick = showErrorOnFailure(function() {
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
        drawGameOverScreen();
        return;
    }
    cells[headIdx] = BM_SEG | dirToBitmask([-direction[0], -direction[1]]);

    if (frontCell & BM_APPLE) {
        appleEatenTimestamp = document.timeline.currentTime;
        placeNewApple();
        const newLength = Math.ceil(currentLength * GROWTH_RATIO);
        pendingGrowth += (newLength - currentLength);
    }

    if (pendingGrowth > 0) {
        pendingGrowth--;
        currentLength++;
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
});

const onKeydown = showErrorOnFailure(function(event) {
    if (event.key === 'R') {
        restartGame();
    }
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
});

const onClick = showErrorOnFailure(function(event) {
    const canvas = document.getElementById('glCanvas');
    const rect = canvas.getBoundingClientRect();

    if (direction[0] === 0) {
        // snake is moving vertically, turn left or right depending on the click position
        const headX = rect.left + (head[0] / N) * rect.width;
        if (event.clientX < headX) {
            nextDirections.push([-1, 0]);
        } else {
            nextDirections.push([1, 0]);
        }
    } else {
        // snake is moving horizontally, turn up or down depending on the click position
        const headY = rect.bottom - (head[1] / N) * rect.height;
        if (event.clientY < headY) {
            nextDirections.push([0, 1]);
        } else {
            nextDirections.push([0, -1]);
        }
    }
});

const onLoad = showErrorOnFailure(function() {
    const canvas = document.getElementById('glCanvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) {
        throw new Error('WebGL 2 not supported');
    }

    restartGame();
    drawGameOverScreen();
    const shaders = initShaders(gl);

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

    // game state array `cells` passed as texture to the first stage fragment shader
    const cellTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, cellTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // text overlay prepared in the nonglCanvas
    const overlayTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, overlayTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    function initFramebuffer(width, height) {
        const framebuffer = gl.createFramebuffer();
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
        return {
            framebuffer,
            texture,
            viewport: [0, 0, width, height]
        };
    }

    const stages = [
        {
            // first stage: render the game state to a 256x256 texture with no noise or CRT effects
            shader: shaders.stage1,
            out: initFramebuffer(256, 256),
            uniforms: {},
        },
        {
            // second stage: add CRT shape distortion, scanlines, noise etc.
            shader: shaders.stage2,
            out: initFramebuffer(canvas.width, canvas.height),
            uniforms: {},
        },
        {
            shader: shaders.bloom,
            out: initFramebuffer(canvas.width, canvas.height),
            uniforms: {
                bloomAxis: { type: "uniform2fv", value: [1.0, 0.0] },
            },
        },
        {
            shader: shaders.bloom,
            out: {
                framebuffer: null,
                texture: null,
                viewport: [0, 0, canvas.width, canvas.height],
            },
            uniforms: {
                bloomAxis: { type: "uniform2fv", value: [0.0, 1.0] },
            },
        },
    ];

    const render = showErrorOnFailure(function(timestamp) {
        const relTimestamp = (timestamp - appleEatenTimestamp) / 1000;
        let noiseLevel = 1.0; // max noise for first 100ms
        if (gameOver) {
            // no noise shown on the game over screen
            noiseLevel = 0.0;
        } else if (relTimestamp > 0.1) {
            // nonlinearly increases up to 100% at TIME_LIMIT
            noiseLevel = Math.log2(1.0 + relTimestamp / TIME_LIMIT);
        }

        for (let stageIdx = 0; stageIdx < stages.length; stageIdx++) {
            const stage = stages[stageIdx];

            // prepare and clear the output
            gl.bindFramebuffer(gl.FRAMEBUFFER, stage.out.framebuffer);
            gl.viewport(...stage.out.viewport);
            gl.clearColor(0.0, 0.0, 0.0, 1.0);
            gl.clear(gl.COLOR_BUFFER_BIT);

            // set up the shader program
            gl.useProgram(stage.shader);
            gl.uniform1i(gl.getUniformLocation(stage.shader, 'stageIn'), 0);
            gl.uniform1i(gl.getUniformLocation(stage.shader, 'overlay'), 1);
            gl.uniform1i(gl.getUniformLocation(stage.shader, 'N'), N);
            gl.uniform1f(gl.getUniformLocation(stage.shader, 'timestamp'), timestamp / 1000);
            gl.uniform1f(gl.getUniformLocation(stage.shader, 'noiseLevel'), noiseLevel);
            gl.uniform1i(gl.getUniformLocation(stage.shader, 'gameOver'), gameOver);
            for (const [name, { type, value }] of Object.entries(stage.uniforms)) {
                gl[type](gl.getUniformLocation(stage.shader, name), value);
            }

            gl.bindVertexArray(vao);
            gl.activeTexture(gl.TEXTURE0);

            const positionLocation = gl.getAttribLocation(stage.shader, 'position');
            const texcoordLocation = gl.getAttribLocation(stage.shader, 'texcoord');
            gl.enableVertexAttribArray(positionLocation);
            gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 16, 0);
            gl.enableVertexAttribArray(texcoordLocation);
            gl.vertexAttribPointer(texcoordLocation, 2, gl.FLOAT, false, 16, 8);

            if (stageIdx == 0) {
                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, cellTexture);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8UI, N, N, 0, gl.RED_INTEGER, gl.UNSIGNED_BYTE, cells);
                gl.activeTexture(gl.TEXTURE1);
                gl.bindTexture(gl.TEXTURE_2D, overlayTexture);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, nonglCanvas);
            } else {
                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, stages[stageIdx - 1].out.texture);
            }

            gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
        }

        requestAnimationFrame(render);
    });

    requestAnimationFrame(render);
    setInterval(tick, 100);
    document.addEventListener('keydown', onKeydown);
    document.addEventListener('click', onClick);
});

window.onload = onLoad;
