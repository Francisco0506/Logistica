// `autoprefixer` SE QUEDA, aunque Tailwind v4 ya prefija por su cuenta.
//
// Se probó quitarlo: el CSS compilado cambia (59,142 -> 59,460 bytes), o sea
// que sí está haciendo algo — consolida prefijos que Lightning CSS deja. No es
// un resto del flujo de la v3 como parecía. Quitarlo tendría que verificarse
// en navegadores reales, no comparando tamaños, y no gana nada medible.
export default {
  plugins: {
    '@tailwindcss/postcss': {},
    autoprefixer: {},
  },
}
