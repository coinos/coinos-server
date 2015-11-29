module.exports = (grunt) ->
  grunt.initConfig(
    pkg: grunt.file.readJSON('package.json')
    coffeeify:
      src: 
        expand: true
        cwd: 'public/js'
        src: ['*.coffee']
        dest: 'public/js'
        ext: '.js'
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
    watch: 
      less:
        files: ['public/css/*.less']
        tasks: ['less']
      coffee:
        files: ['**/*.coffee']
        tasks: ['coffee', 'coffeeify']
  )

  grunt.loadNpmTasks('grunt-coffeeify')
  grunt.loadNpmTasks('grunt-contrib-less')
  grunt.loadNpmTasks('grunt-contrib-coffee')
  grunt.loadNpmTasks('grunt-contrib-watch')
  grunt.registerTask('default', 'watch')
