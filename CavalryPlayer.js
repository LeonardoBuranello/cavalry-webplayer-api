// CORREZIONE: Abbiamo cambiato i percorsi da '/cavalry-demos/wasm-lib/' a './wasm-lib/'
const wasm = await import('./wasm-lib/CavalryWasm.js')

// Configure and create the module instance
const module = await wasm.default({
	// CORREZIONE: Anche qui puntiamo alla cartella relativa corretta
	locateFile: (path) => `./wasm-lib/${path}`,
	// Set info logging function
	print: (text) => console.log(text),
	// Set error logging function
	printErr: (text) => console.error(text),
})

export class CavalryPlayer {
	#animationFrameId = null
	#container = null
	#surface = null
	#controls = null
	#timeline = null
	#playButton = null
	#options = {}
	module = module
	player = null
	canvas = null

	constructor(parent, options = {}) {
		this.#options.autoplay = options.autoplay ?? true
		this.#options.sceneInput = options.sceneInput ?? true
		const canvasId = '#canvas'
		const ui = this.createInterface()
		this.#controls = ui.querySelector('#controls')
		this.#container = ui.querySelector('#container')
		this.#timeline = ui.querySelector('#frameSlider')
		this.canvas = ui.querySelector(canvasId)
		// This allows WASM to find the canvas when it's in shadow DOM
		module.specialHTMLTargets[canvasId] = this.canvas
		this.canvas.addEventListener(
			'webglcontextlost',
			() => this.showPlayerError('WebGL context lost'),
			false,
		)

		const restartButton = ui.querySelector('#restartButton')
		restartButton?.addEventListener('click', () => this.restart())

		const playButton = ui.querySelector('#playButton')
		playButton?.addEventListener('click', () => this.togglePlayback())
		this.#playButton = playButton

		const prevButton = ui.querySelector('#prevButton')
		prevButton?.addEventListener('click', () => this.prev())

		const nextButton = ui.querySelector('#nextButton')
		nextButton?.addEventListener('click', () => this.next())

		const sceneInput = ui.querySelector('#sceneInput')
		sceneInput?.addEventListener('change', async ({ target }) => {
			const file = target.files[0]
			const contents = await file.arrayBuffer()
			await this.loadScene(new Uint8Array(contents), file.name)
		})

		window.addEventListener('resize', (event) => this.resize(event))
		parent.innerHTML = ''
		parent.appendChild(ui)
	}

    // Funzione aggiunta per caricare un file specifico all'avvio (come scene.cv)
    async load(url) {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Impossibile caricare la scena: ${response.statusText}`);
        const contents = await response.arrayBuffer();
        await this.loadScene(new Uint8Array(contents), url.split('/').pop());
    }

	createInterface() {
		const container = document.createElement('div')
		container.className = 'demo-layout'
		container.innerHTML = `
			<div class="viewport-section">
				<div id="container" class="player-container">
					<canvas id="canvas"></canvas>
				</div>
			</div>

			<div class="controls-section">
				${
					this.#options.sceneInput === false
						? ''
						: `<div class="control-group">
						<div class="file-input-wrapper">
							<input type="file" accept=".cv" id="sceneInput" class="file-input" />
							<div class="file-input-button">Carica File .cv</div>
						</div>
					</div>`
				}

				<div class="timeline-controls">
					<div>
						<button id="restartButton">⏮</button>
						<button id="playButton">Play</button>
						<button id="prevButton">◀︎</button>
						<button id="nextButton">▶︎</button>
					</div>
					<input type="range" id="frameSlider" value="0" min="0" max="100" step="1" />
				</div>

				<div id="controls" class="dynamic-controls"></div>
			</div>
    `
		return container
	}

	async loadScene(contents, filename = '', assetsPath = '') {
		try {
			if (this.player) {
				this.stop()
			}
			module.FS.writeFile(filename, contents)
			this.player = module.Cavalry.MakeWithPath(filename)
			if (module.pendingAssets?.length) {
				const assets = module.pendingAssets.map((asset) =>
					this.loadPendingAssets(asset, assetsPath),
				)
				await Promise.all(assets)
			}
			this.loadControlCentreAttributes()
			this.setTimelineAttributes()
			this.resize()
			if (this.#options.autoplay) {
				this.play()
			}
		} catch (error) {
			console.error(error)
			this.showPlayerError(error.message)
		}
	}

	loadControlCentreAttributes() {
		if (!this.player) {
			return
		}
		const compId = this.player.getActiveComp()
		const attributesPointer = this.player.getControlCentreAttributes(compId)
		const attributeIds = vectorToArray(attributesPointer)
		if (!attributeIds.length) {
			this.#controls.innerHTML = `
				<div class="no-controls-message">
					Control Centre vuoto
				</div>
			`
			return
		}
		const controls = this.createControls(attributeIds)
		this.#controls.innerHTML = ''
		this.#controls.appendChild(controls)
	}

	createControls(attributes = []) {
		const controls = document.createElement('div')
		controls.style.all = 'inherit'

		for (const attribute of attributes) {
			const group = document.createElement('div')
			group.className = 'control-group'

			const [layerId, ...attr] = attribute.split('.')
			const attrId = attr.join('.')

			const label = document.createElement('label')
			label.className = 'control-label'
			label.textContent =
				this.player.getAttributeName(layerId, attrId) || attrId
			group.appendChild(label)

			const definition = this.player.getAttributeDefinition(layerId, attrId)
			let value = this.player.getAttribute(layerId, attrId)
			
            const input = this.createControl({
				type: definition.type,
				value: value,
				limits: definition.numericInfo,
				layerId,
				attrId,
			})
			group.appendChild(input)
			controls.appendChild(group)
		}
		return controls
	}

	createControl({ layerId, attrId, type, value, limits }) {
		if (type === 'int' || type === 'double') {
			const input = document.createElement('input')
			input.type = limits.hasHardMin && limits.hasHardMax ? 'range' : 'number'
			input.className = 'control-input'
			input.defaultValue = value
			input.step = limits.step || (type === 'int' ? 1 : 0.1)
			input.min = limits.hasHardMin ? limits.hardMin : (limits.hasSoftMin ? limits.softMin : null)
			input.max = limits.hasHardMax ? limits.hardMax : (limits.hasSoftMax ? limits.softMax : null)
			input.addEventListener('input', ({ target }) => {
				const val = type === 'int' ? parseInt(target.value) : parseFloat(target.value)
				this.player.setAttribute(layerId, attrId, val)
				if (!this.player.isPlaying()) this.render()
			})
			return input
		}

		if (type === 'bool') {
			const input = document.createElement('input')
			input.type = 'checkbox'
			input.defaultChecked = value
			input.addEventListener('change', ({ target }) => {
				this.player.setAttribute(layerId, attrId, target.checked)
				if (!this.player.isPlaying()) this.render()
			})
			return input
		}

		const span = document.createElement('span')
		span.innerText = `Tipo '${type}' non supportato in questo esempio`
		return span
	}

	resize() {
		if (!this.player) return
		const scene = this.player.getSceneResolution()
		const parent = this.canvas.parentElement
		const scaleX = parent.offsetWidth / scene.width
		const scaleY = parent.offsetHeight / scene.height
		const scale = Math.min(scaleX, scaleY)
		const width = scene.width * scale
		const height = scene.height * scale
		this.canvas.width = width
		this.canvas.height = height
		this.#surface = module.makeWebGLSurfaceFromElement(this.canvas, width, height)
		if (!this.player.isPlaying()) this.render()
	}

	showPlayerError(message) {
		const div = document.createElement('div')
		div.className = 'player-error'
		div.innerText = `Errore: ${message}`;
		this.#container.prepend(div)
	}

	setTimelineAttributes() {
		this.#timeline.min = this.player.getStartFrame()
		this.#timeline.max = this.player.getEndFrame()
		this.#timeline.value = this.player.getStartFrame()
		this.#timeline.addEventListener('input', ({ target }) => {
			this.player.setFrame(parseInt(target.value))
			this.render()
		})
	}

	runPlaybackLoop() {
		const tick = (timestamp) => {
			if (!this.player || !this.player.isPlaying()) return
			const status = this.player.tick(this.#surface, timestamp)
			if (status.frameChanged) this.#timeline.value = status.currentFrame
			this.#animationFrameId = requestAnimationFrame(tick)
		}
		this.#animationFrameId = requestAnimationFrame(tick)
	}

	play() {
		if (!this.player) return
		this.player.play()
		this.#playButton.innerText = 'Pause'
		this.runPlaybackLoop()
	}

	stop() {
		if (!this.player) return
		this.player.stop()
		this.#playButton.innerText = 'Play'
		if (this.#animationFrameId !== null) {
			cancelAnimationFrame(this.#animationFrameId)
			this.#animationFrameId = null
		}
	}

	render() {
		if (!this.player) return
		this.player.render(this.#surface)
	}
}

function vectorToArray(vector) {
	if (typeof vector?.size !== 'function') return []
	return new Array(vector.size()).fill(0).map((_, index) => vector.get(index))
}
