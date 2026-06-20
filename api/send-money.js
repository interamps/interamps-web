// api/send-money.js
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { senderId, toAccount, amount, note, otpCode } = req.body;

    try {
        // 1. Fetch Sender Data
        const { data: sender, error: senderErr } = await supabase
        .from('users')
        .select('balance, otp_threshold, account_number')
        .eq('id', senderId)
        .single();

        if (senderErr || !sender) throw new Error("Sender not found");
        if (sender.balance < amount) throw new Error("Insufficient funds");

        // 2. OTP Security Check
        let otpUsed = false;
        if (amount > sender.otp_threshold) {
            if (!otpCode) return res.status(403).json({ error: 'OTP required for this amount' });

            // Fetch stored OTP from your secure KV store or DB table
            const { data: storedOtp } = await supabase.from('otp_codes').select('code').eq('user_id', senderId).single();
            if (storedOtp.code !== otpCode) throw new Error("Invalid or expired OTP");
            otpUsed = true;
        }

        // 3. Database Transaction (RPC or consecutive updates)
        // Note: In Supabase, you should ideally write a Postgres Function (RPC) for atomic money transfers.

        // Deduct from sender
        await supabase.from('users').update({ balance: sender.balance - amount }).eq('id', senderId);

        // Add to receiver
        const { data: receiver } = await supabase.from('users').select('balance').eq('account_number', toAccount).single();
        await supabase.from('users').update({ balance: receiver.balance + amount }).eq('account_number', toAccount);

        // 4. Log Transaction
        const reference_id = `TXN-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
        await supabase.from('transactions').insert([
            { user_id: senderId, type: 'send', amount, from_account: sender.account_number, to_account: toAccount, note, otp_used: otpUsed, reference_id }
        ]);

        return res.status(200).json({ success: true, message: 'Transfer successful', reference_id });

    } catch (error) {
        return res.status(400).json({ error: error.message });
    }
}
