export default defineAppConfig({
  pages: [
    'pages/index/index',
    'pages/create/index',
    'pages/detail/index',
    'pages/mine/index'
  ],
  window: {
    backgroundTextStyle: 'light',
    navigationBarBackgroundColor: '#0F1923',
    navigationBarTitleText: '港瓦夕阳红',
    navigationBarTextStyle: 'white',
    backgroundColor: '#0F1923'
  },
  tabBar: {
    color: '#7F8790',
    selectedColor: '#FF4655',
    backgroundColor: '#0F1923',
    borderStyle: 'black',
    list: [
      {
        pagePath: 'pages/index/index',
        text: '大厅'
      },
      {
        pagePath: 'pages/mine/index',
        text: '我的'
      }
    ]
  }
})
