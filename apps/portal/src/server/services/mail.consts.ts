export const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export const MAIL_TEMPLATES = {
    otp: (code: string, minutes: number) => ({
        subject: `${code} is your Ingot code`,
        text: `Your Ingot verification code is ${code}.\n\nIt expires in ${minutes} minutes. If you didn't request it, you can ignore this email.`
    }),
    invite: (teamName: string, inviter: string, link: string) => ({
        subject: `${inviter} invited you to ${teamName} on Ingot`,
        text: `${inviter} invited you to join the team "${teamName}" on Ingot.\n\nAccept the invitation: ${link}\n\nThe link expires in 7 days.`
    })
};
