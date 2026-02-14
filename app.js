import { CavalryPlayer } from './CavalryPlayer.js';

async function initialise() {
    try {
        // 1. Creiamo il player puntando direttamente all'ID del canvas definito nell'HTML
        const player = new CavalryPlayer('canvas');

        // 2. Carichiamo la scena
        // Assicurati che il file si chiami esattamente scene.cv nella tua cartella principale
        await player.load('./scene.cv');
        
        // 3. Rimuoviamo il caricamento se presente
        document.getElementById('loading')?.remove();
        
        console.log("Cavalry Player + Tweakpane pronti!");
    } catch (error) {
        console.error("Errore durante l'inizializzazione:", error);
        const loadingEl = document.getElementById('loading');
        if (loadingEl) loadingEl.innerText = "Errore nel caricamento. Verifica i file .cv e .wasm";
    }
}

initialise();
