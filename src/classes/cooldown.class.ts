export class COOLDOWN {
    private cooldowns: Map<string, number>;
    
    constructor() {
        this.cooldowns = new Map();
    }

    setCooldown(id: string, time: number) {
        this.cooldowns.set(id, time);
        setTimeout(() => {
            this.cooldowns.delete(id);
        }, time * 1000);
    }

    getCooldown(id: string) {
        return this.cooldowns.get(id);
    }

    hasCooldown(id: string) {
        return this.cooldowns.has(id);
    }

    deleteCooldown(id: string) {
        this.cooldowns.delete(id);
    }

    clearCooldowns() {
        this.cooldowns.clear();
    }

    getCooldowns() {
        return this.cooldowns;
    }
}