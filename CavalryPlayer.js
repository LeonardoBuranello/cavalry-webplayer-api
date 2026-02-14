// 1. IMPORT DEL MOTORE
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

		// Collegamento dei pulsanti
		ui.querySelector('#btn-play').onclick = () => this.togglePlayback()
		ui.querySelector('#btn-restart').onclick = () => this.restart()
		ui.querySelector('#btn-prev').onclick = () => this.prev()
		ui.querySelector('#btn-next').onclick = () => this.next()
		
		this.#playButton = ui.querySelector('#btn-play')
		this.#timeline = ui.querySelector('#frame-slider')
		this.#controls = ui.querySelector('#dynamic-controls')
		this.#container = ui.querySelector('#player-canvas-container')
		this.canvas = ui.querySelector('#canvas')
		
		module.specialHTMLTargets['#canvas'] = this.canvas
		
		window.addEventListener('resize', () => this.resize())
	}

	async load(url) {
		const response = await fetch(url)
		if (!response.ok) throw new Error(`Errore caricamento: ${response.statusText}`)
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

	async loadScene(contents, filename = '') {
		try {
			if (this.player) this.stop()
			module.FS.writeFile(filename, contents)
			this.player = module.Cavalry.MakeWithPath(filename)
			this.loadControlCentreAttributes()
			this.setTimelineAttributes()
			this.resize()
			if (this.#options.autoplay) this.play()
		} catch (error) {
			console.error(error)
		}
	}

	loadControlCentreAttributes() {
		if (!this.player) return
		const compId = this.player.getActiveComp()
		const attributesPointer = this.player.getControlCentreAttributes(compId)
		const attributeIds = vectorToArray(attributesPointer)
		this.#controls.innerHTML = ''
		if (attributeIds.length > 0) {
			this.#controls.appendChild(this.createControls(attributeIds))
		} else {
			this.#controls.innerHTML = '<div style="padding:10px; opacity:0.5">Nessun controllo</div>'
		}
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
			
			const definition = this.player.getAttributeDefinition(layerId, attrId)
			const input = this.createControl({
				type: definition.type,
				value: this.player.getAttribute(layerId, attrId),
				limits: definition.numericInfo,
				layerId,
				attrId
			})
			
			group.appendChild(label)
			group.appendChild(input)
			fragment.appendChild(group)
		}
		return fragment
	}

	createControl({ layerId, attrId, type, value, limits }) {
    const input = document.createElement('input');
    input.className = 'control-input';

    // "Color" RGB picker/selector
		
    if (type === 'color' || attrId.toLowerCase().includes('color')) {
        input.type = 'color';
        input.style.height = '40px'; // Lo rende un bel tastone colorato
        input.oninput = (e) => {
            this.player.setAttribute(layerId, attrId, e.target.value);
            if (!this.player.isPlaying()) this.render();
        };
    } 
    // Altrimenti resta uno slider o un numero
    else if (type === 'int' || type === 'double') {
        input.type = limits.hasHardMin && limits.hasHardMax ? 'range' : 'number';
        // ... resto del codice che hai già ...
    }
    return input;
}

	resize() {
		if (!this.player || !this.canvas) return
		const scene = this.player.getSceneResolution()
		const parent = this.canvas.parentElement
		if (!parent) return

		const scale = Math.min(
			(parent.offsetWidth * 0.9) / scene.width, 
			(parent.offsetHeight * 0.9) / scene.height
		)
		
		this.canvas.width = scene.width * scale
		this.canvas.height = scene.height * scale
		this.#surface = module.makeWebGLSurfaceFromElement(this.canvas, this.canvas.width, this.canvas.height)
		if (!this.player.isPlaying()) this.render()
	}

	setTimelineAttributes() {
		this.#timeline.min = this.player.getStartFrame()
		this.#timeline.max = this.player.getEndFrame()
		this.#timeline.value = this.player.getStartFrame()
		this.#timeline.oninput = (e) => {
			this.player.setFrame(parseInt(e.target.value))
			this.render()
		}
	}

	togglePlayback() {
		if (!this.player) return
		this.player.isPlaying() ? this.stop() : this.play()
	}

	play() {
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
		this.player.stop()
		this.#playButton.innerText = 'Play'
		cancelAnimationFrame(this.#animationFrameId)
	}

	restart() {
		this.player.setFrame(0)
		this.#timeline.value = 0
		if (!this.player.isPlaying()) this.render()
	}

	prev() { this.player.setFrame(this.player.getCurrentFrame() - 1); this.render(); }
	next() { this.player.setFrame(this.player.getCurrentFrame() + 1); this.render(); }
	render() { this.player.render(this.#surface) }
}

function vectorToArray(vector) {
	if (typeof vector?.size !== 'function') return []
	return new Array(vector.size()).fill(0).map((_, index) => vector.get(index))
}
