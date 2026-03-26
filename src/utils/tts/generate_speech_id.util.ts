export function generateSpeechID(length: number = 8): string {
    const alphabet = '0123456789ABCDEF';
    let result = '';

    for (let index = 0; index < length; index += 1) {
        result += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
    }

    return result;
}
