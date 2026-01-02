export async function verifyRecaptcha(token: string) {
    const secretKey = process.env.RECAPTCHA_SECRET_KEY || '6LeIxAcTAAAAAGG-vFI1TnRWxMZNFojJ4WifJWeG';
    // Google test mode: always returns success
    if (secretKey === '6LeIxAcTAAAAAGG-vFI1TnRWxMZNFojJ4WifJWeG') return true;

    try {
        const response = await fetch('https://www.google.com/recaptcha/api/siteverify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `secret=${secretKey}&response=${token}`,
        });

        const data = await response.json();
        return data.success;
    } catch (error) {
        console.error('reCAPTCHA verification error:', error);
        return false;
    }
}
