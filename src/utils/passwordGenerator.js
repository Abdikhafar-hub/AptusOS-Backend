const crypto = require('crypto');

const UPPERCASE = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWERCASE = 'abcdefghijkmnopqrstuvwxyz';
const NUMBERS = '23456789';
const SYMBOLS = '!@#$%^&*()-_=+[]{}:,.?';

const ALL = `${UPPERCASE}${LOWERCASE}${NUMBERS}${SYMBOLS}`;
const DEFAULT_LENGTH = 10;

const randomIndex = (max) => crypto.randomInt(0, max);

const pickRandom = (charset) => charset[randomIndex(charset.length)];

const shuffle = (input) => {
  const values = [...input];
  for (let i = values.length - 1; i > 0; i -= 1) {
    const j = randomIndex(i + 1);
    [values[i], values[j]] = [values[j], values[i]];
  }
  return values.join('');
};

const hasPolicyCompliance = (password) => (
  password.length >= DEFAULT_LENGTH &&
  [...password].some((char) => UPPERCASE.includes(char)) &&
  [...password].some((char) => LOWERCASE.includes(char)) &&
  [...password].some((char) => NUMBERS.includes(char)) &&
  [...password].some((char) => SYMBOLS.includes(char))
);

const generateTemporaryPassword = (length = DEFAULT_LENGTH) => {
  const targetLength = Math.max(length, DEFAULT_LENGTH);

  while (true) {
    const required = [
      pickRandom(UPPERCASE),
      pickRandom(LOWERCASE),
      pickRandom(NUMBERS),
      pickRandom(SYMBOLS)
    ];

    const remainder = Array.from(
      { length: targetLength - required.length },
      () => pickRandom(ALL)
    );

    const password = shuffle([...required, ...remainder].join(''));
    if (hasPolicyCompliance(password)) return password;
  }
};

module.exports = {
  generateTemporaryPassword
};
