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
    watch: 
      less: 
        files: ['public/css/**/*.less']
        tasks: ['less']
      coffee:
        files: ['**/*.coffee']
        tasks: ['coffee']
  )

  grunt.loadNpmTasks('grunt-contrib-coffee')
  grunt.loadNpmTasks('grunt-contrib-less')
  grunt.loadNpmTasks('grunt-contrib-watch')
  grunt.registerTask('default', ['less', 'coffee']);
