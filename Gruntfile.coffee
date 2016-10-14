module.exports = (grunt) ->
  grunt.initConfig(
    pkg: grunt.file.readJSON('package.json')
    coffee:
      server: 
        expand: true
        cwd: 'src'
        src: '**/*.coffee'
        dest: '.'
        ext: '.js'
    less:
      options:
        paths: ["public/css"]
      src:
        expand: true
        cwd: "public/css"
        src: "*.less"
        dest: 'public/css'
        ext: ".css"
    browserSync:
      dev:
        bsFiles:
          src: ['views/**/*.html', 'public/js/*.js', 'public/css/*.css']
        options:
          open: 'local'
          proxy: 'http://localhost:3000/'
          watchTask: true
    watch: 
      less:
        files: ['public/css/*.less']
        tasks: ['newer:less']
      coffee:
        files: ['**/*.coffee']
        tasks: ['newer:coffee', 'newer:coffeeify']
  )

  grunt.loadNpmTasks('grunt-browser-sync')
  grunt.loadNpmTasks('grunt-contrib-less')
  grunt.loadNpmTasks('grunt-contrib-coffee')
  grunt.loadNpmTasks('grunt-contrib-watch')
  grunt.loadNpmTasks('grunt-newer')
  grunt.registerTask('default', ['browserSync', 'watch'])
