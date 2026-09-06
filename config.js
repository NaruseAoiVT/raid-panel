/* ============================================================
   RAID PANEL 設定ファイル
   ここだけ書き換えれば動きます。プログラムの知識は不要です。
   ============================================================ */
window.RAIDPANEL_CONFIG = {

  /* Twitch Developer Console で発行した Client ID を貼る（必須）
     https://dev.twitch.tv/console/apps  */
  CLIENT_ID: "",

  /* Twitch アプリに登録した「OAuth リダイレクト URL」と完全に同じ文字列。
     空にしておくと、今このページを開いている URL を自動で使います。
     GitHub Pages に置くなら空のままでOK。 */
  REDIRECT_URI: "",

  /* 監視するチャンネル名。空ならログインした本人のチャンネルを自動で使う。 */
  CHANNEL: "",

  /* レイドを受けたら自動で公式シャウトアウトを送るか */
  AUTO_SHOUTOUT: true,

  /* 通知音を鳴らすか */
  SOUND: true,

  /* 見た目 : "night" / "pastel" / "mono" */
  THEME: "night",

  /* お礼ポストのひな形。{name} {login} {count} が置き換わります。 */
  THANKS_TEMPLATE: "{name}さん、{count}人でのレイドありがとうございました！\nまた遊びに行きます\nhttps://twitch.tv/{login}"
};
