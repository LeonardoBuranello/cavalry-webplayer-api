// 1. IMPORT DEL MOTORE (Percorsi relativi corretti)
const wasm = await import('./wasm-lib/CavalryWasm.js')

const module = await wasm.default({
	locateFile: (path) => `./wasm-lib/${path}`,
	print: (text) => console.log(text),
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
		
		const ui = this.createInterface()
		parent.innerHTML = ''
		parent.appendChild(ui)

		// Collegamento dei pulsanti tramite ID
		ui.querySelector('#btn-play').addEventListener('click', () => this.togglePlayback())
		ui.querySelector('#btn-restart').addEventListener('click', () => this.restart())
		ui.querySelector('#btn-prev').addEventListener('click', () => this.prev())
		ui.querySelector('#btn-next').addEventListener('click', () => this.next())
		
		this.#playButton = ui.querySelector('#btn-play')
		this.#timeline = ui.querySelector('#frame-slider')
		this.#controls = ui.querySelector('#dynamic-controls')
		this.#container = ui.querySelector('#player-canvas-container')
		this.canvas = ui.querySelector('#canvas')
		
		// Inizializzazione motore grafico
		module.specialHTMLTargets['#canvas'] = this.canvas
		
		window.addEventListener('resize', () => this.resize())
	}

	// Metodo per caricare il file .cv
	async load(url) {
		const response = await fetch(url)
		if (!response.ok) throw new Error(`Impossibile caricare la scena: ${response.statusText}`)
		const contents = await response.arrayBuffer()
		await this.loadScene(new Uint8Array(contents), url.split('/').pop())
	}

	createInterface() {
		const container = document.createElement('div')
		container.className = 'player-ui-root'
		container.innerHTML = `
			<div class="main-layout">
				<div id="player-canvas-container" class="canvas-area">
					<canvas id="canvas"></canvas>
				</div>
				
				<div class="sidebar">
					<div class="toolbar">
						<button id="btn-restart" title="Ricomincia">⏮</button>
						<button id="btn-prev">◀</button>
						<button id="btn-play">Pause</button>
						<button id="btn-next">▶</button>
					</div>
					
					<div class="slider-container">
						<input type="range" id="frame-slider" value="0">
					</div>

					<div class="control-centre-header">Control Centre</div>
					<div id="dynamic-controls" class="controls-grid"></div>
				</div>
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
			this.loadControlCentreAttributes()
			this.setTimelineAttributes()
			this.resize() // Chiamata al resize dopo il caricamento
			if (this.#options.autoplay) {
				this.play()
			}
		} catch (error) {
			console.error(error)
			this.showPlayerError(error.message)
		}
	}

	loadControlCentreAttributes() {
		if (!this.player) return
		const compId = this.player.getActiveComp()
		const attributesPointer = this.player.getControlCentreAttributes(compId)
		const attributeIds = vectorToArray(attributesPointer)
		if (!attributeIds.length) {
			this.#controls.innerHTML = `<div class="no-controls">Control Centre vuoto</div>`
			return
		}
		const controls = this.createControls(attributeIds)
		this.#controls.innerHTML = ''
		this.#controls.appendChild(controls)
	}

	createControls(attributes = []) {
		const fragment = document.createDocumentFragment()
		for (const attribute of attributes) {
			const group = document.createElement('div')
			group.className = 'control-group'
			const [layerId, ...attr] = attribute.split('.')
			const attrId = attr.join('.')
			const label = document.createElement('label')
			label.className = 'control-label'
			label.textContent = this.player.getAttributeName(layerId, attrId) || attrId
			group.appendChild(label)
			const definition = this.player.getAttributeDefinition(layerId, attrId)
			const input = this.createControl({
				type: definition.type,
				value: this.player.getAttribute(layerId, attrId),
				limits: definition.numericInfo,
				layerId,
				attrId,
			})
			group.appendChild(input)
			fragment.appendChild(group)
		}
		return fragment
	}

	createControl({ layerId, attrId, type, value, limits }) {
		const input = document.createElement('input')
		input.className = 'control-input'
		if (type === 'int' || type === 'double') {
			input.type = limits.hasHardMin && limits.hasHardMax ? 'range' : 'number'
			input.defaultValue = value
			input.step = limits.step || (type === 'int' ? 1 : 0.1)
			input.min = limits.hasHardMin ? limits.hardMin : (limits.hasSoftMin ? limits.softMin : null)
			input.max = limits.hasHardMax ? limits.hardMax : (limits.hasSoftMax ? limits.softMax : null)
			input.addEventListener('input', ({ target }) => {
				const val = type === 'int' ? parseInt(target.value) : parseFloat(target.value)
				this.player.setAttribute(layerId, attrId, val)
				if (!this.player.isPlaying()) this.render()
			})
		} else if (type === 'bool') {
			input.type = 'checkbox'
			input.checked = value
			input.addEventListener('change', ({ target }) => {
				this.player.setAttribute(layerId, attrId, target.checked)
				if (!this.player.isPlaying()) this.render()
			})
		}
		return input
	}

	// Metodo Resize Ottimizzato
	resize() {
		if (!this.player || !this.canvas) return
		const scene = this.player.getSceneResolution()
		const parent = this.canvas.parentElement
		
		if (!parent) return

		// Calcola la scala lasciando un margine del 10% (0.9)
		const scale = Math.min(
			(parent.offsetWidth * 0.9) / scene.width, 
			(parent.offsetHeight * 0.9) / scene.height
		)
		
		this.canvas.width = scene.width * scale
		this.canvas.height = scene.height * scale
		
		this.#surface = module.makeWebGLSurfaceFromElement(this.canvas, this.canvas.width, this.canvas.height)
		
		if (!this.player.isPlaying()) {
			this.render()
		}
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

	togglePlayback() {
		if (!this.player) return
		this.player.isPlaying() ? this.stop() : this.play()
	}

	play() {
		if (!this.player) return
		this.player.play()
		this.#playButton.innerText = 'Pause'
		const tick = (timestamp) => {
			if (!this.player || !this.player.isPlaying()) return
			const status = this.player.tick(this.#surface, timestamp)
			if (status.frameChanged) this.#timeline.value = status.currentFrame
			this.#animationFrameId = requestAnimationFrame(tick)
		}
		this.#animationFrameId = requestAnimationFrame(tick)
	}

	stop() {
		if (!this.player) return
		this.player.stop()
		this.#playButton.innerText = 'Play'
		if (this.#animationFrameId) {
			cancelAnimationFrame(this.#animationFrameId)
		}
	}

	restart() {
		if (!this.player) return
		this.player.setFrame(0)
		this.#timeline.value = 0
		this.render()
	}

	prev() { 
		if (!this.player) return
		this.player.setFrame(this.player.getCurrentFrame() - 1)
		this.render() 
	}
	
	next() { 
		if (!this.player) return
		this.player.setFrame(this.player.getCurrentFrame() + 1)
		this.render() 
	}

	render() { 
		if (this.player && this.#surface) {
			this.player.render(this.#surface) 
		}
	}

	showPlayerError(message) {
		const div = document.createElement('div')
		div.className = 'player-error'
		div.style.color = "red"
		div.innerText = `Errore: ${message}`
		this.#container.prepend(div)
	}
}

function vectorToArray(vector) {
	if (typeof vector?.size !== 'function') return []
	return new Array(vector.size()).fill(0).map((_, index) => vector.get
